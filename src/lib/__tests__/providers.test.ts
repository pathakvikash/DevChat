import { describe, it, expect } from "vitest";
import { PROVIDERS, providerForModel, bareModelId, isChatModel, isCliModelId } from "@/lib/providers";

describe("providers registry", () => {
  it("has unique ids, env keys and setting keys", () => {
    for (const field of ["id", "envKey", "settingKey"] as const) {
      const values = PROVIDERS.map((p) => p[field]);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it("keeps the pre-existing setting keys so saved keys still resolve", () => {
    expect(providerForModel("openrouter/x")?.settingKey).toBe("openrouterApiKey");
    expect(providerForModel("nvidia-nim/x")?.settingKey).toBe("nvidiaNimApiKey");
  });

  it("maps model ids to providers by prefix, keeping nested upstream ids intact", () => {
    const id = "openrouter/meta-llama/llama-3.3-70b-instruct:free";
    expect(providerForModel(id)?.id).toBe("openrouter");
    expect(bareModelId(id)).toBe("meta-llama/llama-3.3-70b-instruct:free");
    expect(providerForModel("ollama/llama3.2")).toBeUndefined();
    expect(providerForModel("gpt-4o")).toBeUndefined();
  });

  it("filters non-chat models out of provider catalogs", () => {
    expect(isChatModel("openai", "gpt-4o")).toBe(true);
    expect(isChatModel("openai", "o3-mini")).toBe(true);
    expect(isChatModel("openai", "text-embedding-3-small")).toBe(false);
    expect(isChatModel("openai", "whisper-1")).toBe(false);
    expect(isChatModel("openai", "dall-e-3")).toBe(false);
    expect(isChatModel("google", "gemini-2.5-flash")).toBe(true);
    expect(isChatModel("google", "text-embedding-004")).toBe(false);
    expect(isChatModel("google", "gemini-2.5-flash-preview-tts")).toBe(false);
    expect(isChatModel("anthropic", "claude-sonnet-4-5")).toBe(true);
    expect(isChatModel("custom", "anything-goes")).toBe(true);
  });

  it("registers LM Studio as a keyless local preset with a live model list", () => {
    const lm = PROVIDERS.find((p) => p.id === "lmstudio");
    expect(lm).toMatchObject({
      label: "LM Studio",
      envKey: "LMSTUDIO_API_KEY",
      envBaseUrl: "LMSTUDIO_BASE_URL",
      settingKey: "lmstudioApiKey",
      baseUrlSettingKey: "lmstudioBaseUrl",
      baseUrl: "http://localhost:1234/v1",
      keyOptional: true,
      fallbackKey: "lm-studio",
      defaultContextWindow: 32_768,
    });
    expect(lm?.native).toBeUndefined();
  });

  it("resolves LM Studio model ids, keeping nested upstream ids intact", () => {
    expect(providerForModel("lmstudio/qwen/qwen3.5-9b")?.id).toBe("lmstudio");
    expect(bareModelId("lmstudio/qwen/qwen3.5-9b")).toBe("qwen/qwen3.5-9b");
  });

  it("drops LM Studio embedding models from the chat list", () => {
    expect(isChatModel("lmstudio", "qwen/qwen3.5-9b")).toBe(true);
    expect(isChatModel("lmstudio", "text-embedding-nomic-embed-text-v1.5")).toBe(false);
  });

  it("marks only OpenAI and Anthropic for native SDKs", () => {
    const native = Object.fromEntries(PROVIDERS.map((p) => [p.id, p.native]));
    expect(native).toEqual({
      openai: "openai",
      anthropic: "anthropic",
      google: undefined,
      openrouter: undefined,
      "nvidia-nim": undefined,
      lmstudio: undefined,
      custom: undefined,
    });
  });
});

describe("isCliModelId", () => {
  it("is false for an id without a slash, true for a CLI provider prefix", () => {
    expect(isCliModelId("claude-code")).toBe(false);
    expect(isCliModelId("gpt-4o")).toBe(false);
    expect(isCliModelId("claude-code/sonnet")).toBe(true);
    expect(isCliModelId("openai/gpt-4o")).toBe(false);
  });
});
