import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/chat/route";

vi.mock("@/lib/db", () => ({
  prisma: {
    conversation: { findUnique: vi.fn(), update: vi.fn() },
    message: { findMany: vi.fn().mockResolvedValue([]) },
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
vi.mock("@/lib/claude/sessions", () => ({ isRunnableCwd: vi.fn(async () => false) }));
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
