import { describe, expect, it, vi } from "vitest";

const models = vi.hoisted(() => ({ list: [] as { id: string; supportsTools?: boolean }[] }));
vi.mock("@/lib/apiKeys", () => ({ resolveProviderCreds: vi.fn(async () => ({ ollama: {}, anthropic: {} })) }));
vi.mock("@/lib/hostAccess", () => ({ canUseHostTools: vi.fn(async () => false) }));
vi.mock("@/lib/settings", () => ({ getSettingsKey: vi.fn(async () => null) }));
vi.mock("@/lib/models", () => ({ listModels: vi.fn(async () => ({ models: models.list, status: [] })), initializeOllamaModels: vi.fn() }));

import { resolveModelCandidates } from "@/lib/chat/resolveModelCandidates";

describe("resolveModelCandidates default model", () => {
  it("uses the same order as a new chat: Haiku 5.5 over a local model", async () => {
    models.list = [{ id: "ollama/llama", supportsTools: true }, { id: "anthropic/claude-haiku-5-5" }];
    const r = await resolveModelCandidates({ requestedModel: undefined, fallbackModel: undefined, userId: "u" });
    expect(r.ok && r.model).toBe("anthropic/claude-haiku-5-5");
  });

  it("falls to a local model when Haiku is not listed", async () => {
    models.list = [{ id: "openai/gpt-x" }, { id: "ollama/llama", supportsTools: true }];
    const r = await resolveModelCandidates({ requestedModel: undefined, fallbackModel: undefined, userId: "u" });
    expect(r.ok && r.model).toBe("ollama/llama");
  });
});
