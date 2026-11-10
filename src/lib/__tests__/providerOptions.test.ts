import { describe, it, expect } from "vitest";
import { providerOptionsFor, type ProviderOptionsInput } from "@/lib/chat/providerOptions";

const base: ProviderOptionsInput = {
  modelId: "gpt-4o",
  numCtx: 8192,
  cwd: "",
  access: "chat",
  conversationId: "",
  userId: "u1",
  allowedTools: [],
};

describe("providerOptionsFor", () => {
  it("gives a hosted model no options", () => {
    expect(providerOptionsFor(base)).toBeUndefined();
    expect(providerOptionsFor({ ...base, modelId: "openai/gpt-4o" })).toBeUndefined();
  });

  it("gives Ollama the sampling window exactly as the chat route built it", () => {
    expect(providerOptionsFor({ ...base, modelId: "ollama/llama3", numCtx: 16384, temperature: 0.4, topP: null, maxTokens: null })).toEqual({
      ollama: { num_ctx: 16384, temperature: 0.4, top_p: 0.9, num_predict: -1 },
    });
    expect(providerOptionsFor({ ...base, modelId: "ollama/llama3", temperature: 0.7, topP: 0.5, maxTokens: 300 })).toEqual({
      ollama: { num_ctx: 8192, temperature: 0.7, top_p: 0.5, num_predict: 300 },
    });
  });

  it("hands the stream the same Ollama object the retry path widens, and shares nothing between calls", () => {
    // The chat route passes `providerOptions` to the stream, and on a context overflow it sets
    // providerOptions.ollama.num_ctx before the next attempt: the stream must see that change.
    const options = providerOptionsFor({ ...base, modelId: "ollama/llama3", numCtx: 8192 });
    const other = providerOptionsFor({ ...base, modelId: "ollama/llama3", numCtx: 8192 });
    const streamArgs = { providerOptions: options };
    if (options && "ollama" in options && options.ollama) options.ollama.num_ctx = 32768; // as route.ts does
    expect(streamArgs.providerOptions).toMatchObject({ ollama: { num_ctx: 32768 } });
    expect(other).toMatchObject({ ollama: { num_ctx: 8192 } });
  });

  it("gives a CLI model its effort, folder, access, chat and allow list", () => {
    expect(
      providerOptionsFor({ ...base, modelId: "claude-code/sonnet", reasoningEffort: "high", cwd: "/work/app", access: "agent", conversationId: "c1", allowedTools: ["Edit"] }),
    ).toEqual({ "claude-code": { effort: "high", cwd: "/work/app", access: "agent", conversationId: "c1", userId: "u1", allowedTools: ["Edit"] } });
    expect(providerOptionsFor({ ...base, modelId: "codex/default" })).toEqual({
      codex: { effort: "", cwd: "", access: "chat", conversationId: "", userId: "u1", allowedTools: [] },
    });
  });
});
