import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/chat/route";

vi.mock("@/lib/db", () => ({
  prisma: {
    conversation: { findUnique: vi.fn(), update: vi.fn() },
    message: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
    knowledgeBase: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn().mockResolvedValue("u1") }));
vi.mock("@/lib/settings", () => ({ getSettingsKey: vi.fn() }));
vi.mock("@/lib/models", () => ({
  getModel: vi.fn(() => ({ supportsTools: true, model: {}, contextWindow: 8192 })),
}));
vi.mock("@/lib/chat/resolveModelCandidates", () => ({
  resolveModelCandidates: vi.fn(async ({ requestedModel }: { requestedModel: string }) => ({
    ok: true,
    model: requestedModel,
    candidateModels: [requestedModel],
    creds: {},
  })),
}));
vi.mock("@/lib/chat/buildSystemPrompt", () => ({
  buildSystemPrompt: vi.fn(async () => ({ text: "", sections: {}, mainContext: null })),
}));
vi.mock("@/lib/chat/buildTools", () => ({
  buildTools: vi.fn(async () => ({})),
  resolveActiveToolIds: vi.fn(() => new Set<string>()),
  canStartSubAgents: vi.fn(() => false),
  runAgentTool: vi.fn(),
}));
vi.mock("@/lib/chat/saveUserMessage", () => ({ saveUserMessage: vi.fn() }));
vi.mock("@/lib/chat/persistAssistantMessage", () => ({ safePersistAssistantMessage: vi.fn() }));
vi.mock("@/lib/chat/autoCompress", () => ({ autoCompress: vi.fn(), canAutoCompress: vi.fn(() => false) }));
vi.mock("@/lib/observability", () => ({ recordTrace: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/folders", () => ({ isAllowedFolder: vi.fn(async () => false), folderGoneMessage: (f: string) => `${f} isn't one of your folders any more.` }));
vi.mock("@/lib/cliProviders", () => ({
  cliProviderForModel: vi.fn((id: string) => (id.startsWith("claude-code/") ? { id: "claude-code" } : undefined)),
  dropParkedRuns: vi.fn(),
}));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  streamText: vi.fn(() => ({
    toUIMessageStream: () => new ReadableStream({ start: (c) => c.close() }),
  })),
  convertToModelMessages: vi.fn(async () => []),
}));

import { prisma } from "@/lib/db";
import { getModel } from "@/lib/models";
import { buildTools } from "@/lib/chat/buildTools";
import { dropParkedRuns } from "@/lib/cliProviders";
import { resetHostAccessCache } from "@/lib/hostAccess";
import { isAllowedFolder } from "@/lib/folders";
import { buildSystemPrompt } from "@/lib/chat/buildSystemPrompt";
const db = prisma as any;

const row = (extra: Record<string, unknown> = {}) => ({
  userId: "u1", compressedAt: null, kind: "main", parent: null, model: "mock/chat", systemPrompt: null,
  temperature: 0.7, kbId: null, contextLength: null, topP: null, maxTokens: null, chatOnlyMode: false,
  memoryDisabled: false, temporary: false, maxToolCalls: 5, fallbackModel: null, reasoningEffort: null,
  workingFolder: null, ...extra,
});

const userMessage = { id: "m1", role: "user", content: "hi", parts: [{ type: "text", text: "hi" }] };
/** The saved model wins over the request's, so a test picks it on the chat's row. */
function send(model: string, messages: unknown[] = [userMessage], conversationId = "c1") {
  db.conversation.findUnique.mockResolvedValue(row({ model }));
  return POST(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ conversationId, model, messages }) }) as any);
}

const saved = process.env.OWNER_EMAILS;
beforeEach(() => {
  vi.clearAllMocks();
  resetHostAccessCache();
  delete process.env.OWNER_EMAILS;
  db.conversation.findUnique.mockResolvedValue(row());
  db.user.findUnique.mockResolvedValue({ email: "someone@example.com" });
});
afterEach(() => {
  if (saved === undefined) delete process.env.OWNER_EMAILS;
  else process.env.OWNER_EMAILS = saved;
});

describe("POST /api/chat: CLI models belong to the server's owner", () => {
  it("refuses a CLI model with 403 for a user who is not an owner", async () => {
    process.env.OWNER_EMAILS = "owner@example.com";
    const res = await send("claude-code/default");
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/server's owner/);
    expect(buildTools).not.toHaveBeenCalled();
  });

  it("lets an owner (any letter case, listed among others) use a CLI model", async () => {
    process.env.OWNER_EMAILS = " Other@example.com , SOMEONE@example.com ";
    const res = await send("claude-code/default");
    expect(res.status).toBe(200);
    expect(vi.mocked(getModel).mock.calls[0][2]).toBe(true);
  });

  it("keeps today's behaviour when OWNER_EMAILS is unset", async () => {
    const res = await send("claude-code/default");
    expect(res.status).toBe(200);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("a chat whose folder is no longer allowed gets a 400 with the message and no model call", async () => {
    db.conversation.findUnique.mockResolvedValue(row({ workingFolder: "/work/gone" }));
    const res = await POST(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ conversationId: "c1", model: "mock/chat", messages: [userMessage] }) }) as any);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/isn't one of your folders any more/);
    expect(getModel).not.toHaveBeenCalled();
  });

  it("a non-owner's leftover folder is ignored on a hosted model: no 400, no folder check", async () => {
    process.env.OWNER_EMAILS = "owner@example.com";
    db.conversation.findUnique.mockResolvedValue(row({ workingFolder: "/work/gone" }));
    const res = await POST(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ conversationId: "c1", model: "mock/chat", messages: [userMessage] }) }) as any);
    expect(res.status).toBe(200);
    expect(isAllowedFolder).not.toHaveBeenCalled();
  });

  it("still serves a non-owner on a hosted model, without host tools", async () => {
    process.env.OWNER_EMAILS = "owner@example.com";
    const res = await send("mock/chat");
    expect(res.status).toBe(200);
    expect(vi.mocked(getModel).mock.calls[0][2]).toBe(false);
  });
});

describe("POST /api/chat: another user's open card is not theirs to close", () => {
  it("leaves the parked run alone when the chat belongs to someone else, or does not exist", async () => {
    const post = () => POST(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ conversationId: "c1", model: "mock/chat", messages: [userMessage] }) }) as any);
    db.conversation.findUnique.mockResolvedValue(row({ userId: "u2" }));
    expect((await post()).status).toBe(404);
    db.conversation.findUnique.mockResolvedValue(null);
    expect((await post()).status).toBe(404);
    expect(dropParkedRuns).not.toHaveBeenCalled();
  });

  it("does not close it either when the request fails before the owner is known", async () => {
    db.conversation.findUnique.mockRejectedValue(new Error("db down"));
    const res = await POST(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ conversationId: "c1", model: "mock/chat", messages: [userMessage] }) }) as any);
    expect(res.status).toBe(500);
    expect(dropParkedRuns).not.toHaveBeenCalled();
  });

  it("closes the chat's own card when its owner sends something else", async () => {
    expect((await send("mock/chat")).status).toBe(200);
    expect(dropParkedRuns).toHaveBeenCalledWith("c1");
  });
});

describe("POST /api/chat: the read-only folder tools", () => {
  const post = (model: string, over: Record<string, unknown> = {}) => {
    db.conversation.findUnique.mockResolvedValue(row({ model, workingFolder: "/work/app", ...over }));
    return POST(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ conversationId: "c1", model, messages: [userMessage] }) }) as any);
  };
  const folderArg = () => vi.mocked(buildTools).mock.calls[0]?.[0].workingFolder;

  beforeEach(() => vi.mocked(isAllowedFolder).mockResolvedValue(true));

  it("passes the folder to an API model of the owner, and tells the prompt", async () => {
    expect((await post("mock/chat")).status).toBe(200);
    expect(folderArg()).toBe("/work/app");
    expect(vi.mocked(buildSystemPrompt).mock.calls[0][0]).toMatchObject({ fileFolder: "/work/app", showFolder: false });
  });

  it("a folder chat offers no sendToChat; a chat without a folder still does", async () => {
    const panes = [{ id: "side1", title: "Side", kind: "side" }];
    const run = (workingFolder: string | null, messages: unknown[] = [userMessage]) => {
      db.conversation.findUnique.mockResolvedValue(row({ model: "mock/chat", workingFolder }));
      return POST(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ conversationId: "c1", model: "mock/chat", messages, openPanes: panes }) }) as any);
    };
    await run("/work/app");
    expect(vi.mocked(buildTools).mock.calls[0][0]).toMatchObject({ agentTargets: [], askBeforeSendingOut: true });
    expect(vi.mocked(buildSystemPrompt).mock.calls[0][0].agentTargets).toEqual([]);
    vi.clearAllMocks();
    await run(null);
    expect(vi.mocked(buildTools).mock.calls[0][0]).toMatchObject({ agentTargets: [{ id: "side1", title: "Side" }], askBeforeSendingOut: false });
  });

  it("a chat that read files keeps the gate after the folder is cleared", async () => {
    const read = { id: "m2", role: "assistant", parts: [{ type: "tool-readFile", toolCallId: "t1", state: "output-available", input: {}, output: "x" }] };
    db.conversation.findUnique.mockResolvedValue(row({ model: "mock/chat", workingFolder: null }));
    await POST(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ conversationId: "c1", model: "mock/chat", messages: [userMessage, read, { ...userMessage, id: "m3" }], openPanes: [{ id: "side1", title: "Side", kind: "side" }] }) }) as any);
    const arg = vi.mocked(buildTools).mock.calls[0][0];
    expect(arg).toMatchObject({ askBeforeSendingOut: true, agentTargets: [] });
    expect(arg.workingFolder).toBeUndefined();
  });

  it("a compressed chat that read files keeps the gate after the folder is cleared", async () => {
    // The summarized messages are not sent, so the request holds no folder-tool part; the stored history does.
    db.message.findMany.mockResolvedValueOnce([{ id: "old" }]);
    db.conversation.findUnique.mockResolvedValue(row({ model: "mock/chat", workingFolder: null }));
    await POST(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ conversationId: "c1", model: "mock/chat", messages: [userMessage] }) }) as any);
    expect(vi.mocked(buildTools).mock.calls[0][0]).toMatchObject({ askBeforeSendingOut: true });
    expect(vi.mocked(buildTools).mock.calls[0][0].workingFolder).toBeUndefined();
  });

  it("a chat whose helper read files keeps the gate", async () => {
    // The helper's tool calls are saved on its child chat, so the lookup must cover children of this chat.
    db.message.findMany.mockImplementation(async ({ where }: any) =>
      JSON.stringify(where.conversation ?? {}).includes('"parentId":"c1"') ? [{ id: "kid-msg" }] : [],
    );
    db.conversation.findUnique.mockResolvedValue(row({ model: "mock/chat", workingFolder: null }));
    await POST(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ conversationId: "c1", model: "mock/chat", messages: [userMessage] }) }) as any);
    expect(vi.mocked(buildTools).mock.calls[0][0]).toMatchObject({ askBeforeSendingOut: true });
    db.message.findMany.mockReset().mockResolvedValue([]);
  });

  it("passes nothing for a CLI model, which has its own file access", async () => {
    expect((await post("claude-code/default")).status).toBe(200);
    expect(folderArg()).toBeUndefined();
    expect(vi.mocked(buildSystemPrompt).mock.calls[0][0]).toMatchObject({ fileFolder: undefined, showFolder: true });
  });

  it("passes nothing to a user who is not an owner", async () => {
    process.env.OWNER_EMAILS = "owner@example.com";
    expect((await post("mock/chat")).status).toBe(200);
    expect(folderArg()).toBeUndefined();
    expect(isAllowedFolder).not.toHaveBeenCalled();
  });

  it("passes nothing for a model without tools or in chat-only mode", async () => {
    vi.mocked(getModel).mockReturnValueOnce({ supportsTools: false, model: {}, contextWindow: 8192 } as any);
    await post("mock/chat");
    expect(buildTools).not.toHaveBeenCalled();
    expect(vi.mocked(buildSystemPrompt).mock.calls[0][0].fileFolder).toBeUndefined();

    vi.clearAllMocks();
    await post("mock/chat", { chatOnlyMode: true });
    expect(buildTools).not.toHaveBeenCalled();
    expect(vi.mocked(buildSystemPrompt).mock.calls[0][0].fileFolder).toBeUndefined();
  });

  it("passes nothing once the folder is no longer allowed", async () => {
    vi.mocked(isAllowedFolder).mockResolvedValue(false);
    expect((await post("mock/chat")).status).toBe(400);
    expect(buildTools).not.toHaveBeenCalled();
  });
});
