import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/conversations/[id]/context/route";

vi.mock("@/lib/db", () => ({
  prisma: { conversation: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn().mockResolvedValue("u1") }));
vi.mock("@/lib/models", () => ({ getModel: vi.fn(() => ({ supportsTools: true, contextWindow: 8192 })) }));
vi.mock("@/lib/apiKeys", () => ({ resolveProviderCreds: vi.fn(async () => ({})) }));
vi.mock("@/lib/chat/buildTools", () => ({ resolveActiveToolIds: vi.fn(() => new Set<string>()) }));
vi.mock("@/lib/chat/buildSystemPrompt", () => ({
  buildSystemPrompt: vi.fn(async () => ({
    text: "",
    sections: { base: "base", instructions: null, persona: null, skills: null, tools: null, memory: null, compressed: null, main: null, kb: null, generativeUi: null },
    mainContext: { shown: 2, total: 5 },
  })),
}));

import { prisma } from "@/lib/db";
import { buildSystemPrompt } from "@/lib/chat/buildSystemPrompt";
import { resolveActiveToolIds } from "@/lib/chat/buildTools";
const db = prisma as any;

const conv = (extra: Record<string, unknown> = {}) => ({
  userId: "u1",
  model: "mock/chat",
  systemPrompt: null,
  contextLength: null,
  compressedAt: null,
  compressedSummary: null,
  chatOnlyMode: false,
  memoryDisabled: false,
  temporary: false,
  kbId: null,
  kind: "main",
  parent: null,
  messages: [],
  ...extra,
});

const get = (id: string) => GET(new NextRequest(`http://localhost/api/conversations/${id}/context`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/conversations/[id]/context for side chats", () => {
  it("uses the main chat's knowledge base, chat mode, and returns mainContext", async () => {
    db.conversation.findUnique.mockResolvedValue(
      conv({ kind: "side", kbId: "own-kb", parent: { userId: "u1", kbId: "main-kb", temporary: false } }),
    );
    const res = await get("s1");
    expect(res.status).toBe(200);
    const opts = (buildSystemPrompt as any).mock.calls[0][0];
    expect(opts).toMatchObject({ kbId: "main-kb", mode: "chat", conversationId: "s1" });
    expect(resolveActiveToolIds).toHaveBeenCalledWith([], [], "main-kb");
    expect((await res.json()).mainContext).toEqual({ shown: 2, total: 5 });
  });

  it("answers 404 when the parent belongs to another user", async () => {
    db.conversation.findUnique.mockResolvedValue(
      conv({ kind: "side", parent: { userId: "u2", kbId: null, temporary: false } }),
    );
    expect((await get("s1")).status).toBe(404);
    expect(buildSystemPrompt).not.toHaveBeenCalled();
  });

  it("keeps a main chat's own knowledge base and default mode", async () => {
    db.conversation.findUnique.mockResolvedValue(conv({ kbId: "own-kb" }));
    await get("c1");
    const opts = (buildSystemPrompt as any).mock.calls[0][0];
    expect(opts.kbId).toBe("own-kb");
    expect(opts.mode).toBeUndefined();
  });
});
