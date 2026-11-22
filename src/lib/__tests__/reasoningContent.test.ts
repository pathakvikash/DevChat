import { describe, it, expect } from "vitest";
import { withReasoningContent } from "@/lib/reasoningContent";

const data = (c: object) => `data: ${JSON.stringify(c)}\n\n`;

/** An SSE reply: the given chunks, then [DONE] unless `done` is false. */
const sse = (chunks: object[], done = true) =>
  new Response(chunks.map(data).join("") + (done ? "data: [DONE]\n\n" : ""), {
    headers: { "content-type": "text/event-stream" },
  });

/** The parsed deltas the rewritten stream would hand the AI SDK, in order (no [DONE]). */
async function streamedDeltas(upstream: Response): Promise<Record<string, unknown>[]> {
  const wrapped = withReasoningContent(async () => upstream);
  const text = await (await wrapped("http://x/v1/chat/completions")).text();
  return text
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => JSON.parse(l.slice(6)).choices?.[0]?.delta)
    .filter((d): d is Record<string, unknown> => !!d);
}

/** The content the AI SDK would assemble from the stream. */
async function streamedContent(upstream: Response): Promise<string> {
  return (await streamedDeltas(upstream)).map((d) => d.content ?? "").join("");
}

describe("withReasoningContent", () => {
  it("turns streamed reasoning_content into a <think> block before the answer", async () => {
    const content = await streamedContent(
      sse([
        { choices: [{ delta: { reasoning_content: "Let me " } }] },
        { choices: [{ delta: { reasoning_content: "think." } }] },
        { choices: [{ delta: { content: "Hi" } }] },
        { choices: [{ delta: { content: " there" }, finish_reason: "stop" }] },
      ]),
    );
    expect(content).toBe("<think>Let me think.</think>Hi there");
  });

  it("closes an unfinished thinking block when the reply ends", async () => {
    const content = await streamedContent(
      sse([{ choices: [{ delta: { reasoning_content: "still" } }] }, { choices: [{ delta: {}, finish_reason: "length" }] }]),
    );
    expect(content).toBe("<think>still</think>");
  });

  it("leaves plain streams untouched", async () => {
    const content = await streamedContent(sse([{ choices: [{ delta: { content: "plain" } }] }]));
    expect(content).toBe("plain");
  });

  it("folds reasoning_content into the content of a non-streamed reply", async () => {
    const body = { choices: [{ message: { role: "assistant", content: "42", reasoning_content: "Adding." }, finish_reason: "stop" }] };
    const wrapped = withReasoningContent(async () => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }));
    const json = await (await wrapped("http://x")).json();
    expect(json.choices[0].message.content).toBe("<think>Adding.</think>42");
    expect(json.choices[0].message.reasoning_content).toBeUndefined();
  });

  it("closes the thinking block before a tool call, keeping the tool call intact", async () => {
    const toolCall = { index: 0, id: "c1", function: { name: "search", arguments: "{}" } };
    const deltas = await streamedDeltas(
      sse([
        { choices: [{ delta: { reasoning_content: "I should search." } }] },
        { choices: [{ delta: { tool_calls: [toolCall] } }] },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      ]),
    );
    expect(deltas.map((d) => d.content ?? "").join("")).toBe("<think>I should search.</think>");
    expect(deltas[1].tool_calls).toEqual([toolCall]);
  });

  it("closes an open block when the stream ends without a finish chunk or [DONE]", async () => {
    const content = await streamedContent(
      sse(
        [{ choices: [{ delta: { reasoning_content: "partial" } }] }, { usage: { total_tokens: 3 } }],
        false,
      ),
    );
    expect(content).toBe("<think>partial</think>");
  });

  it("closes a block exactly once when the last chunk has no delta and [DONE] follows", async () => {
    const content = await streamedContent(
      sse([
        { choices: [{ delta: { reasoning_content: "x" } }] },
        { choices: [{ finish_reason: "stop" }] },
        { usage: { total_tokens: 3 } },
      ]),
    );
    expect(content).toBe("<think>x</think>");
    expect(content.split("</think>").length - 1).toBe(1);
  });

  it("accepts `reasoning` as an alias for reasoning_content", async () => {
    const content = await streamedContent(
      sse([{ choices: [{ delta: { reasoning: "r" } }] }, { choices: [{ delta: { content: "a" }, finish_reason: "stop" }] }]),
    );
    expect(content).toBe("<think>r</think>a");
  });
});
