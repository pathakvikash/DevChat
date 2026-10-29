import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/chat/route";

vi.mock("@/lib/db", () => ({
  prisma: {
    conversation: { findUnique: vi.fn(), update: vi.fn() },
    message: { findMany: vi.fn().mockResolvedValue([]) },
    knowledgeBase: { findUnique: vi.fn() },
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
vi.mock("@/lib/cliProviders", () => ({ cliProviderForModel: vi.fn(() => undefined), dropParkedRuns: vi.fn() }));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  streamText: vi.fn(() => ({
    toUIMessageStream: () => new ReadableStream({ start: (c) => c.close() }),
  })),
  convertToModelMessages: vi.fn(async () => []),
}));

import { prisma } from "@/lib/db";
import { buildTools } from "@/lib/chat/buildTools";
import { buildSystemPrompt } from "@/lib/chat/buildSystemPrompt";
const db = prisma as any;

/** One row serves both the ownership check and resolveChatSettings. */
function chat(extra: Record<string, unknown> = {}) {
  return {
    userId: "u1",
    compressedAt: null,
    kind: "main",
    parent: null,
    model: "mock/chat",
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
    ...extra,
  };
}

const sideOf = (parent: Record<string, unknown> = {}) =>
  chat({ kind: "side", parent: { userId: "u1", workingFolder: null, kbId: null, temporary: false, ...parent } });

function send(conversationId: string, mode: string) {
  return POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        conversationId,
        mode,
        model: "mock/chat",
        messages: [{ id: "m1", role: "user", content: "hi", parts: [{ type: "text", text: "hi" }] }],
      }),
    }) as any,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/chat for side chats", () => {
  it("forces chat mode on a side chat, whatever mode the request asks for", async () => {
    db.conversation.findUnique.mockResolvedValue(sideOf());
    const res = await send("s1", "agent");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Debug-Tool-Mode")).toBe("chat");
    expect((buildTools as any).mock.calls[0][0].mode).toBe("chat");
    expect((buildSystemPrompt as any).mock.calls[0][0]).toMatchObject({ mode: "chat", conversationId: "s1", contextWindow: 8192 });
  });

  it("keeps agent mode for a main chat", async () => {
    db.conversation.findUnique.mockResolvedValue(chat());
    const res = await send("c1", "agent");
    expect(res.headers.get("X-Debug-Tool-Mode")).toBe("agent");
    expect((buildTools as any).mock.calls[0][0].mode).toBe("agent");
  });

  it("refuses a side chat whose parent belongs to another user", async () => {
    db.conversation.findUnique.mockResolvedValue(sideOf({ userId: "u2" }));
    const res = await send("s1", "chat");
    expect(res.status).toBe(404);
    expect(buildTools).not.toHaveBeenCalled();
  });

  it("refuses a sub-agent run sent as a chat", async () => {
    db.conversation.findUnique.mockResolvedValue(chat({ kind: "subagent" }));
    const res = await send("a1", "chat");
    expect(res.status).toBe(400);
    expect(buildTools).not.toHaveBeenCalled();
  });
});
