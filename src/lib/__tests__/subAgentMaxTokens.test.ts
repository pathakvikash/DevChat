import { describe, it, expect } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { runSubAgent } from "@/lib/chat/subAgent";

/** The output cap a helper's request carries, for a model whose own cap is `own` and a parent turn cap of `parent`. */
async function capFor(own: number, parent?: number) {
  let seen: number | undefined;
  const model = new MockLanguageModelV3({
    doStream: async (o: any) => {
      seen = o.maxOutputTokens;
      return {
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: "stream-start", warnings: [] });
            c.enqueue({ type: "text-start", id: "t" });
            c.enqueue({ type: "text-delta", id: "t", delta: "ok" });
            c.enqueue({ type: "text-end", id: "t" });
            c.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } });
            c.close();
          },
        }),
      } as any;
    },
  });
  await runSubAgent({
    brief: "go", mode: "chat", tools: {}, abortSignal: new AbortController().signal,
    model: { id: "openai/gpt-5", model, supportsTools: true, maxTokens: own } as any,
    maxTokens: parent,
  });
  return seen;
}

describe("helper output cap", () => {
  it("is at least the parent's per-turn cap, so a reasoning helper still has room to answer", async () => {
    expect(await capFor(4096, 32_000)).toBe(32_000);
    expect(await capFor(4096)).toBe(4096);
    expect(await capFor(8192, 4096)).toBe(8192);
  });
});
