import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET as listConversations } from "@/app/api/conversations/route";
import { GET as modelUsage } from "@/app/api/models/usage/route";
import { GET as analytics } from "@/app/api/analytics/route";
import { GET as dataset } from "@/app/api/dataset/route";
import { POST as suggest } from "@/app/api/conversations/[id]/suggest/route";
import { POST as consolidate } from "@/app/api/memory/consolidate/route";
import { PATCH } from "@/app/api/conversations/[id]/route";

vi.mock("@/lib/db", () => ({
  prisma: {
    conversation: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    message: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn().mockResolvedValue("user-1") }));
vi.mock("@/lib/settings", () => ({ getSettingsKey: vi.fn() }));
vi.mock("@/lib/apiKeys", () => ({ resolveProviderCreds: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/models", () => ({ getModel: vi.fn(() => { throw new Error("no model"); }) }));
vi.mock("@/lib/api/conversations", () => ({ getConversationOrNull: vi.fn() }));
vi.mock("@/lib/llm", () => ({ resolveModel: vi.fn() }));
vi.mock("@/lib/memory", () => ({ consolidateMemory: vi.fn() }));
vi.mock("ai", () => ({ generateText: vi.fn() }));

import { prisma } from "@/lib/db";
import { getConversationOrNull } from "@/lib/api/conversations";
import { consolidateMemory } from "@/lib/memory";
import { generateText } from "ai";
const db = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  db.conversation.findMany.mockResolvedValue([]);
  db.message.findMany.mockResolvedValue([]);
});

describe("side chats are hidden from every list", () => {
  it("the sidebar list", async () => {
    await listConversations(new Request("http://localhost/api/conversations") as any);
    expect(db.conversation.findMany.mock.calls[1][0].where).toMatchObject({ userId: "user-1", temporary: false, parentId: null });
  });

  it("model usage counts main chats only", async () => {
    await modelUsage();
    expect(db.conversation.findMany.mock.calls[0][0].where).toEqual({ userId: "user-1", parentId: null });
  });

  it("analytics counts main chats as conversations, but keeps side chat tokens", async () => {
    db.conversation.findMany.mockResolvedValue([
      { id: "m1", parentId: null, model: "gpt-4o", totalTokens: 100, messages: [] },
      { id: "s1", parentId: "m1", model: "gpt-4o", totalTokens: 40, messages: [] },
    ]);
    const stats = await (await analytics()).json();
    expect(stats.totalConversations).toBe(1);
    expect(stats.totalTokens).toBe(140);
  });

  it("the dataset export takes feedback only from main chats", async () => {
    await dataset(new Request("http://localhost/api/dataset") as any);
    expect(db.message.findMany.mock.calls[0][0].where.conversation).toEqual({ userId: "user-1", parentId: null });
  });
});

describe("side chats get no suggestions and no memory consolidation", () => {
  it("suggest answers null without calling the model", async () => {
    (getConversationOrNull as any).mockResolvedValue({ id: "s1", model: "gpt-4o", kind: "side" });
    const res = await suggest(
      new Request("http://localhost/api/conversations/s1/suggest", { method: "POST", body: JSON.stringify({ user: "hi", assistant: "hello" }) }) as any,
      { params: Promise.resolve({ id: "s1" }) },
    );
    expect(await res.json()).toEqual({ suggestion: null });
    expect(generateText).not.toHaveBeenCalled();
  });

  it("consolidation applies nothing and does not run", async () => {
    db.conversation.findUnique.mockResolvedValue({ userId: "user-1", temporary: false, memoryDisabled: false, kind: "side" });
    const res = await consolidate(
      new Request("http://localhost/api/memory/consolidate", { method: "POST", body: JSON.stringify({ conversationId: "s1" }) }) as any,
    );
    expect(await res.json()).toEqual({ applied: 0, pruned: 0 });
    expect(consolidateMemory).not.toHaveBeenCalled();
  });
});

describe("PATCH cannot change a chat's parent or kind", () => {
  it("drops parentId and kind from the update", async () => {
    db.conversation.updateMany.mockResolvedValue({ count: 1 });
    db.conversation.findUnique.mockResolvedValue({ id: "s1" });
    const res = await PATCH(
      new Request("http://localhost/api/conversations/s1", {
        method: "PATCH",
        body: JSON.stringify({ title: "renamed", parentId: "other-main", kind: "main" }),
      }) as any,
      { params: Promise.resolve({ id: "s1" }) },
    );
    expect(res.status).toBe(200);
    expect(db.conversation.updateMany.mock.calls[0][0].data).toEqual({ title: "renamed" });
  });
});
