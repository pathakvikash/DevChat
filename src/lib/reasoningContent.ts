// LM Studio (and DeepSeek-style servers) send a reasoning model's thinking as `reasoning_content`
// (or `reasoning`), fields the AI SDK's Chat Completions parser ignores. This fetch wrapper moves
// them into the content as <think>...</think>; models.ts then extracts that into reasoning parts.

type Delta = {
  content?: string | null;
  reasoning_content?: string | null;
  reasoning?: string | null;
  tool_calls?: unknown;
};
type Choice = { delta?: Delta; message?: Delta; finish_reason?: string | null };
type Chunk = { choices?: Choice[] };

const CLOSE = "</think>";

function reasoningOf(delta: Delta): string {
  const r = delta.reasoning_content ?? delta.reasoning;
  return typeof r === "string" ? r : "";
}

/** Rewrites one parsed chunk in place. `state.open` tracks an unclosed <think> block. */
function rewriteChunk(data: Chunk, state: { open: boolean }): boolean {
  const choice = data.choices?.[0];
  const delta = choice?.delta;
  if (!choice || !delta) return false;
  const reasoning = reasoningOf(delta);
  const content = delta.content ?? "";
  // Anything that is not more thinking ends the block: answer text, a tool call, or the end of the reply.
  const ends = !!(content || choice.finish_reason || delta.tool_calls);
  if (!reasoning && !(state.open && ends)) return false;
  let out = "";
  if (reasoning) {
    if (!state.open) out += "<think>";
    state.open = true;
    out += reasoning;
  }
  if (state.open && ends) {
    out += CLOSE;
    state.open = false;
  }
  out += content;
  delta.content = out;
  delete delta.reasoning_content;
  delete delta.reasoning;
  return true;
}

/** Wraps a fetch so Chat Completions responses carry reasoning inside the content. */
export function withReasoningContent(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    const res = await fetchImpl(input, init);
    if (!res.body) return res;
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("text/event-stream")) return sseResponse(res);
    if (!type.includes("application/json")) return res;
    const json = (await res.clone().json().catch(() => null)) as Chunk | null;
    const message = json?.choices?.[0]?.message;
    if (!json || !message || !reasoningOf(message)) return res;
    // A whole reply is one "chunk" that also ends the thinking block.
    rewriteChunk({ choices: [{ delta: message, finish_reason: "stop" }] }, { open: false });
    return new Response(JSON.stringify(json), { status: res.status, statusText: res.statusText, headers: res.headers });
  };
}

function sseResponse(res: Response): Response {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const state = { open: false };
  let pending = "";

  const closingLine = () => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: CLOSE } }] })}`;

  /** Output lines for one input line. Closing before [DONE] keeps the close ahead of the end marker. */
  const rewriteLine = (text: string): string[] => {
    if (!text.startsWith("data:")) return [text];
    const payload = text.slice(5).trim();
    if (!payload) return [text];
    if (payload === "[DONE]") {
      if (!state.open) return [text];
      state.open = false;
      return [closingLine(), text];
    }
    try {
      const data = JSON.parse(payload);
      return [rewriteChunk(data, state) ? `data: ${JSON.stringify(data)}` : text];
    } catch {
      return [text];
    }
  };

  const body = res.body!.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        pending += decoder.decode(chunk, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const l of lines) for (const out of rewriteLine(l)) controller.enqueue(encoder.encode(`${out}\n`));
      },
      flush(controller) {
        pending += decoder.decode();
        if (pending) for (const out of rewriteLine(pending)) controller.enqueue(encoder.encode(`${out}\n`));
        // A stream that ends without [DONE] still gets its block closed, exactly once.
        if (state.open) {
          state.open = false;
          controller.enqueue(encoder.encode(`${closingLine()}\n`));
        }
      },
    }),
  );
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}
