import { beforeEach, describe, expect, it, vi } from "vitest";

const models = vi.hoisted(() => ({ list: [] as { id: string; supportsTools?: boolean }[], saved: null as string | null }));
vi.mock("@/lib/apiKeys", () => ({ resolveProviderCreds: vi.fn(async () => ({ ollama: {}, anthropic: {}, openrouter: {}, openai: {} })) }));
vi.mock("@/lib/hostAccess", () => ({ canUseHostTools: vi.fn(async () => false) }));
vi.mock("@/lib/settings", () => ({ getSettingsKey: vi.fn(async () => models.saved) }));
vi.mock("@/lib/models", () => ({ listModels: vi.fn(async () => ({ models: models.list, status: [] })), initializeOllamaModels: vi.fn() }));

import { resolveModelCandidates } from "@/lib/chat/resolveModelCandidates";

const run = (requestedModel?: string, fallbackModel?: string) => resolveModelCandidates({ requestedModel, fallbackModel, userId: "u" });
const HAIKU_OR = "openrouter/anthropic/claude-haiku-5.5";

describe("resolveModelCandidates default model", () => {
  beforeEach(() => { models.saved = null; });

  it("uses the same order as a new chat: Haiku 5.5 over a local model", async () => {
    models.list = [{ id: "ollama/llama", supportsTools: true }, { id: "anthropic/claude-haiku-5-5" }];
    const r = await run();
    expect(r.ok && r.model).toBe("anthropic/claude-haiku-5-5");
  });

  it("with no model asked for, the candidates are the top three, so a rejected first falls to the second", async () => {
    models.list = [{ id: "openai/gpt-x" }, { id: "openrouter/a/b:free", supportsTools: true }, { id: HAIKU_OR }, { id: "ollama/l" }];
    const r = await run(undefined, "openai/fb");
    expect(r.ok && r.candidateModels).toEqual(["ollama/l", HAIKU_OR, "openrouter/a/b:free", "openai/fb"]);
  });

  it("a named model stays first, with the existing fallbacks only", async () => {
    models.list = [{ id: "anthropic/claude-haiku-5-5" }];
    const r = await run("openai/gpt-x", "openai/fb");
    expect(r.ok && r.candidateModels).toEqual(["openai/gpt-x", "openai/fb"]);
  });

  it("does not try a saved Ollama or claude-code default that the server does not list", async () => {
    models.list = [{ id: "openai/gpt-x" }];
    for (models.saved of ["ollama/llama3.2:3b", "claude-code/default"]) {
      const r = await run();
      expect(r.ok && r.candidateModels).toEqual(["openai/gpt-x"]);
    }
  });
});
