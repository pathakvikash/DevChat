import { beforeEach, describe, expect, it, vi } from "vitest";

const listModels = vi.hoisted(() => vi.fn());
const saved = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("@/lib/apiKeys", () => ({ resolveProviderCreds: vi.fn(async () => ({})) }));
vi.mock("@/lib/hostAccess", () => ({ canUseHostTools: vi.fn(async () => false) }));
vi.mock("@/lib/mockModels", () => ({ mockModelCatalog: () => [] }));
vi.mock("@/lib/settings", () => ({ getSettingsKey: vi.fn(async () => saved.value) }));
vi.mock("@/lib/models", () => ({ listModels }));

import { resolveNewChatModel } from "@/lib/resolveNewChatModel";

const model = (id: string) => ({ id });

describe("resolveNewChatModel", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

  it("keeps the saved model when its provider errored (it lists no models then)", async () => {
    saved.value = "openai/gpt-x";
    listModels.mockResolvedValue({
      models: [model("anthropic/claude-haiku-5-5")],
      status: [{ id: "openai", label: "OpenAI", configured: true, modelCount: 0, error: "Could not reach this provider" }],
    });
    expect(await resolveNewChatModel("u1")).toEqual({ id: "openai/gpt-x", replaced: null, auto: false });
  });

  it("still replaces a saved model that is gone while its provider answers", async () => {
    saved.value = "openai/gpt-x";
    listModels.mockResolvedValue({
      models: [model("anthropic/claude-haiku-5-5")],
      status: [{ id: "openai", label: "OpenAI", configured: true, modelCount: 3 }],
    });
    expect((await resolveNewChatModel("u1")).replaced).toBe("openai/gpt-x");
  });
});
