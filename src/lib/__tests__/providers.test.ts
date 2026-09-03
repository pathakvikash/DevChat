import { describe, it, expect } from "vitest";
import { PROVIDERS, providerForModel, bareModelId, isChatModel } from "@/lib/providers";

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
});
