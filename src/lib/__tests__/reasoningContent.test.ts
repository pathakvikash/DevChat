import { describe, it, expect } from "vitest";
import { withReasoningContent } from "@/lib/reasoningContent";

const sse = (chunks: object[]) =>
  new Response([...chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`), "data: [DONE]\n\n"].join(""), {
    headers: { "content-type": "text/event-stream" },
  });

/** Runs the wrapped fetch and returns the content the AI SDK would assemble from the stream. */
async function streamedContent(upstream: Response): Promise<string> {
  const wrapped = withReasoningContent(async () => upstream);
  const text = await (await wrapped("http://x/v1/chat/completions")).text();
  return text
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => JSON.parse(l.slice(6)).choices[0].delta.content ?? "")
    .join("");
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
});
