import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveChatSettings, type ResolveChatSettingsOptions } from "@/lib/chat/resolveChatSettings";

vi.mock("@/lib/db", () => ({
  prisma: { conversation: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/settings", () => ({ getSettingsKey: vi.fn() }));

import { prisma } from "@/lib/db";
const db = prisma as any;

const opts: ResolveChatSettingsOptions = {
  userId: "u1",
  conversationId: "s1",
  bodyModel: "mock/chat",
  bodySystemPrompt: undefined,
  bodyTemperature: undefined,
  bodyKbId: "body-kb",
  bodySearchProvider: undefined,
  bodyEnabledTools: undefined,
  bodyEnabledSkills: undefined,
  bodyChatOnlyMode: undefined,
  bodyMemoryDisabled: undefined,
  bodyAutoCompressThreshold: undefined,
  bodyMaxToolCalls: undefined,
};

const row = (extra: Record<string, unknown> = {}) => ({
  model: "mock/side",
  systemPrompt: null,
  temperature: 0.7,
  kbId: null,
  contextLength: null,
  topP: null,
  maxTokens: null,
  chatOnlyMode: false,
  memoryDisabled: false,
  temporary: false,
  maxToolCalls: 5,
  fallbackModel: null,
  reasoningEffort: null,
  workingFolder: null,
  kind: "main",
  parent: null,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveChatSettings for a side chat", () => {
  it("takes the main chat's folder and knowledge base, and returns the kind", async () => {
    db.conversation.findUnique.mockResolvedValue(
      row({
        kind: "side",
        workingFolder: "/own/folder",
        kbId: "own-kb",
        parent: { userId: "u1", workingFolder: "/work/app", kbId: "main-kb", temporary: false },
      }),
    );
    const settings = await resolveChatSettings(opts);
    expect(settings.kind).toBe("side");
    expect(settings.workingFolder).toBe("/work/app");
    expect(settings.kbId).toBe("main-kb");
    expect(settings.model).toBe("mock/side");
  });

  it("uses no folder or knowledge base when the main chat has none", async () => {
    db.conversation.findUnique.mockResolvedValue(
      row({ kind: "side", parent: { userId: "u1", workingFolder: null, kbId: null, temporary: false } }),
    );
    const settings = await resolveChatSettings(opts);
    expect(settings.workingFolder).toBeUndefined();
    expect(settings.kbId).toBeUndefined();
  });

  it("turns memory off when the main chat is temporary", async () => {
    db.conversation.findUnique.mockResolvedValue(
      row({ kind: "side", parent: { userId: "u1", workingFolder: null, kbId: null, temporary: true } }),
    );
    expect((await resolveChatSettings(opts)).memoryDisabled).toBe(true);
  });

  it("keeps a main chat's own settings", async () => {
    db.conversation.findUnique.mockResolvedValue(row({ workingFolder: "/own" }));
    const settings = await resolveChatSettings(opts);
    expect(settings.kind).toBe("main");
    expect(settings.workingFolder).toBe("/own");
  });
});
