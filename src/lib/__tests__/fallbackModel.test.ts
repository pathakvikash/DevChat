import { describe, it, expect, vi } from "vitest";
import { withFallback } from "@/lib/chat/fallbackModel";

const streamOf = (...chunks: any[]) =>
  new ReadableStream({
    start(c) {
      chunks.forEach((x) => c.enqueue(x));
      c.close();
    },
  });
const ok = (text: string) => ({ stream: streamOf({ type: "text-delta", id: "1", delta: text }) });
const mock = (doStream: any) => ({ specificationVersion: "v3", provider: "p", modelId: "m", supportedUrls: {}, doStream, doGenerate: vi.fn() });
const call = (model: any) => model.doStream({ prompt: [], providerOptions: { x: 1 } });
const read = async (s: ReadableStream) => {
  const out: any[] = [];
  const r = s.getReader();
  for (;;) {
    const { done, value } = await r.read();
    if (done) return out;
    out.push(value);
  }
};

describe("withFallback", () => {
  it("uses the next candidate when the first rejects 429 on every try", async () => {
    const first = vi.fn().mockRejectedValue(new Error("429 rate limit"));
    const second = vi.fn().mockResolvedValue(ok("hi"));
    const model = withFallback(mock(first), {
      primaryId: "openai/a",
      fallbacks: [{ id: "groq/b", model: mock(second), providerOptions: { y: 2 } }],
      baseDelayMs: 0,
    });
    const res = await call(model);
    expect(await read(res.stream)).toEqual([{ type: "text-delta", id: "1", delta: "hi" }]);
    expect(first).toHaveBeenCalledTimes(2);
    expect(second.mock.calls[0][0].providerOptions).toEqual({ y: 2 });
  });

  it("retries a transient error on the same model before falling back", async () => {
    const first = vi.fn().mockRejectedValueOnce(new Error("503 overloaded")).mockResolvedValueOnce(ok("again"));
    const second = vi.fn();
    const model = withFallback(mock(first), { primaryId: "openai/a", fallbacks: [{ id: "groq/b", model: mock(second) }], baseDelayMs: 0 });
    await call(model);
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).not.toHaveBeenCalled();
  });

  it("does not fall back after a chunk was emitted", async () => {
    const boom = new ReadableStream({
      start(c) {
        c.enqueue({ type: "text-delta", id: "1", delta: "a" });
        c.error(new Error("429 mid-stream"));
      },
    });
    const first = vi.fn().mockResolvedValue({ stream: boom });
    const second = vi.fn();
    const model = withFallback(mock(first), { primaryId: "openai/a", fallbacks: [{ id: "groq/b", model: mock(second) }], baseDelayMs: 0 });
    const res = await call(model);
    await expect(read(res.stream)).rejects.toThrow("429 mid-stream");
    expect(second).not.toHaveBeenCalled();
  });

  it("does not fall back on a non-retryable 400", async () => {
    const first = vi.fn().mockRejectedValue(new Error("max_tokens is too large"));
    const second = vi.fn();
    const model = withFallback(mock(first), { primaryId: "openai/a", fallbacks: [{ id: "groq/b", model: mock(second) }], baseDelayMs: 0 });
    await expect(call(model)).rejects.toThrow("max_tokens");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("falls back on an auth error without retrying, and throws the primary's error when all fail", async () => {
    const first = vi.fn().mockRejectedValue(new Error("401 Unauthorized"));
    const second = vi.fn().mockRejectedValue(new Error("500 server error"));
    const model = withFallback(mock(first), { primaryId: "openai/a", fallbacks: [{ id: "groq/b", model: mock(second) }], baseDelayMs: 0 });
    await expect(call(model)).rejects.toThrow("401");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalled();
  });

  it("bumps num_ctx on an Ollama context overflow and retries the same model", async () => {
    const first = vi
      .fn()
      .mockRejectedValueOnce(new Error("the request exceeds the available context size"))
      .mockResolvedValueOnce(ok("fits"));
    const bump = vi.fn().mockResolvedValue(32768);
    const model = withFallback(mock(first), { primaryId: "ollama/llama3", fallbacks: [], onContextOverflow: bump, baseDelayMs: 0 });
    await call(model);
    expect(bump).toHaveBeenCalledWith("ollama/llama3");
    expect(first.mock.calls[1][0].providerOptions.ollama.options.num_ctx).toBe(32768);
  });
});
