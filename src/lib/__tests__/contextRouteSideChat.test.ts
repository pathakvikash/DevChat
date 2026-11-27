import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/conversations/[id]/context/route";

vi.mock("@/lib/db", () => ({
  prisma: { conversation: { findUnique: vi.fn() }, message: { findMany: vi.fn().mockResolvedValue([]) } },
}));
vi.mock("@/lib/hostAccess", () => ({ canUseHostTools: vi.fn(async () => true) }));
vi.mock("@/lib/cliProviders", () => ({ cliProviderForModel: vi.fn(() => undefined) }));
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
import { cliProviderForModel } from "@/lib/cliProviders";
import { canUseHostTools } from "@/lib/hostAccess";
import { countTokens } from "@/lib/tokens";
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
    expect(resolveActiveToolIds).toHaveBeenCalledWith([], []);
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

  it("passes the folder, the gate and showFolder like the chat route", async () => {
    db.conversation.findUnique.mockResolvedValue(conv({ workingFolder: "/work" }));
    await get("c1");
    expect((buildSystemPrompt as any).mock.calls[0][0]).toMatchObject({ fileFolder: "/work", sendsOutGate: true, showFolder: false });
  });

  it("a user without host access gets no folder in the panel", async () => {
    vi.mocked(canUseHostTools).mockResolvedValueOnce(false);
    db.conversation.findUnique.mockResolvedValue(conv({ workingFolder: "/work" }));
    await get("c1");
    expect((buildSystemPrompt as any).mock.calls[0][0]).toMatchObject({ fileFolder: undefined, showFolder: false });
  });

  it("a chat that read files stays gated with the folder cleared", async () => {
    db.conversation.findUnique.mockResolvedValue(conv());
    db.message.findMany.mockResolvedValueOnce([{ id: "m1" }]);
    await get("c1");
    expect((buildSystemPrompt as any).mock.calls[0][0]).toMatchObject({ fileFolder: undefined, sendsOutGate: true });
    db.message.findMany.mockResolvedValue([]);
    await get("c1");
    expect((buildSystemPrompt as any).mock.calls[1][0].sendsOutGate).toBe(false);
  });

  it("a CLI side chat sees the main chat's folder line", async () => {
    vi.mocked(cliProviderForModel).mockReturnValueOnce({} as any);
    db.conversation.findUnique.mockResolvedValue(
      conv({ kind: "side", parentId: "p1", parent: { userId: "u1", kbId: null, temporary: false, workingFolder: "/main" } }),
    );
    await get("s1");
    expect((buildSystemPrompt as any).mock.calls[0][0]).toMatchObject({ fileFolder: undefined, showFolder: true, sendsOutGate: true });
  });

  it("counts the folder section and folder tools under Tool Descriptions", async () => {
    const withFolder = (folder: string | null) =>
      vi.mocked(buildSystemPrompt).mockResolvedValueOnce({
        text: "",
        sections: { base: "base", instructions: null, persona: null, skills: null, tools: null, folder, memory: null, compressed: null, main: null, kb: null, generativeUi: null },
        mainContext: null,
      });
    db.conversation.findUnique.mockResolvedValue(conv({ workingFolder: "/work" }));
    withFolder("--- Working folder ---\nYour working folder is /work.");
    const on = (await (await get("c1")).json()).breakdown.tools;
    db.conversation.findUnique.mockResolvedValue(conv());
    withFolder(null);
    const off = (await (await get("c1")).json()).breakdown.tools;
    expect(off).toBe(0);
    expect(on).toBeGreaterThan(countTokens("--- Working folder ---\nYour working folder is /work."));
  });
});
