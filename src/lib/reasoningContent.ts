// LM Studio (and DeepSeek-style servers) send a reasoning model's thinking as `reasoning_content`,
// a field the AI SDK's Chat Completions parser ignores. This fetch wrapper moves it into the
// content as <think>...</think>, which MessageBubble already shows as a thinking block.

type Delta = { content?: string | null; reasoning_content?: string | null };
type Choice = { delta?: Delta; message?: Delta; finish_reason?: string | null };

/** Rewrites one SSE `data:` payload in place. `open` tracks whether a <think> block is still unclosed. */
function rewriteChunk(data: { choices?: Choice[] }, state: { open: boolean }): boolean {
  const choice = data.choices?.[0];
  const delta = choice?.delta;
  if (!choice || !delta) return false;
  const reasoning = delta.reasoning_content ?? "";
  const content = delta.content ?? "";
  if (!reasoning && !(state.open && (content || choice.finish_reason))) return false;
  let out = "";
  if (reasoning) {
    if (!state.open) out += "<think>";
    state.open = true;
    out += reasoning;
  }
  if (state.open && (content || choice.finish_reason)) {
    out += "</think>";
    state.open = false;
  }
  out += content;
  delta.content = out;
  delete delta.reasoning_content;
  return true;
}

/** Wraps a fetch so Chat Completions responses carry reasoning_content inside the content. */
export function withReasoningContent(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    const res = await fetchImpl(input, init);
    if (!res.body) return res;
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("text/event-stream")) return sseResponse(res);
    if (!type.includes("application/json")) return res;
    const json = (await res.clone().json().catch(() => null)) as { choices?: Choice[] } | null;
    const message = json?.choices?.[0]?.message;
    if (!json || !message?.reasoning_content) return res;
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

  const line = (text: string) => {
    if (!text.startsWith("data:")) return text;
    const payload = text.slice(5).trim();
    if (!payload || payload === "[DONE]") return text;
    try {
      const data = JSON.parse(payload);
      return rewriteChunk(data, state) ? `data: ${JSON.stringify(data)}` : text;
    } catch {
      return text;
    }
  };

  const body = res.body!.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        pending += decoder.decode(chunk, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const l of lines) controller.enqueue(encoder.encode(`${line(l)}\n`));
      },
      flush(controller) {
        pending += decoder.decode();
        if (pending) controller.enqueue(encoder.encode(line(pending)));
      },
    }),
  );
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}
