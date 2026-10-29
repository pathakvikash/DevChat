import { describe, it, expect, vi, beforeEach } from "vitest";
import { deleteExpiredTemporaryChats, TEMPORARY_CHAT_TTL_MS } from "@/lib/temporaryChat";
import { GET } from "@/app/api/conversations/route";
import { resolveChatSettings } from "@/lib/chat/resolveChatSettings";
import { PATCH, DELETE } from "@/app/api/conversations/[id]/route";

vi.mock("@/lib/db", () => ({
  prisma: {
    conversation: { findMany: vi.fn(), deleteMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    trace: { deleteMany: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn().mockResolvedValue("user-1") }));
vi.mock("@/lib/settings", () => ({ getSettingsKey: vi.fn() }));

import { prisma } from "@/lib/db";
const db = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  db.conversation.findMany.mockResolvedValue([]);
});

describe("deleteExpiredTemporaryChats", () => {
  it("looks only at this user's temporary chats older than 24 hours", async () => {
    const now = Date.parse("2026-10-29T12:00:00Z");
    await deleteExpiredTemporaryChats("user-1", now);
    expect(db.conversation.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        temporary: true,
        updatedAt: { lt: new Date(now - TEMPORARY_CHAT_TTL_MS) },
        children: { none: { updatedAt: { gte: new Date(now - TEMPORARY_CHAT_TTL_MS) } } },
      },
      select: { id: true },
    });
  });

  it("keeps a temporary chat whose side chat was used within the last 24 hours", async () => {
    // The side chat's recent use is part of the where clause, so the database keeps the parent.
    const now = Date.parse("2026-10-29T12:00:00Z");
    await deleteExpiredTemporaryChats("user-1", now);
    const cutoff = new Date(now - TEMPORARY_CHAT_TTL_MS);
    expect(db.conversation.findMany.mock.calls[0][0].where.children).toEqual({ none: { updatedAt: { gte: cutoff } } });
  });

  it("deletes the stale chats and their traces together, side chats' traces included", async () => {
    db.conversation.findMany.mockResolvedValueOnce([{ id: "a" }, { id: "b" }]).mockResolvedValueOnce([{ id: "s1" }]);
    expect(await deleteExpiredTemporaryChats("user-1")).toBe(2);
    expect(db.conversation.findMany).toHaveBeenLastCalledWith({ where: { parentId: { in: ["a", "b"] } }, select: { id: true } });
    expect(db.trace.deleteMany).toHaveBeenCalledWith({ where: { conversationId: { in: ["a", "b", "s1"] } } });
    // temporary: true again, so a chat that stopped being temporary meanwhile survives.
    expect(db.conversation.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["a", "b"] }, userId: "user-1", temporary: true },
    });
  });

  it("deletes nothing when no chat has expired", async () => {
    expect(await deleteExpiredTemporaryChats("user-1")).toBe(0);
    expect(db.trace.deleteMany).not.toHaveBeenCalled();
    expect(db.conversation.deleteMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/conversations", () => {
  it("never lists temporary chats, and sweeps expired ones first", async () => {
    // First findMany is the sweep, second is the list itself.
    await GET(new Request("http://localhost/api/conversations") as any);
    expect(db.conversation.findMany).toHaveBeenCalledTimes(2);
    expect(db.conversation.findMany.mock.calls[0][0].where.temporary).toBe(true);
    expect(db.conversation.findMany.mock.calls[1][0].where).toMatchObject({ userId: "user-1", temporary: false });
  });
});

describe("GET /api/conversations cleanup failure", () => {
  it("still lists chats when the sweep throws", async () => {
    db.conversation.findMany.mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce([{ id: "c1" }]);
    const res = await GET(new Request("http://localhost/api/conversations") as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "c1" }]);
  });
});

const ctx = { params: Promise.resolve({ id: "c1" }) };
const patch = (body: unknown) =>
  PATCH(new Request("http://localhost/api/conversations/c1", { method: "PATCH", body: JSON.stringify(body) }) as any, ctx);
const del = (query = "") =>
  DELETE(new Request(`http://localhost/api/conversations/c1${query}`, { method: "DELETE" }) as any, ctx);

describe("PATCH temporary", () => {
  beforeEach(() => {
    db.conversation.updateMany.mockResolvedValue({ count: 1 });
    db.conversation.findUnique.mockResolvedValue({ id: "c1" });
  });

  it("rejects a non-boolean value", async () => {
    expect((await patch({ temporary: "yes" })).status).toBe(400);
    expect(db.conversation.updateMany).not.toHaveBeenCalled();
  });

  it("only turns it on for a chat with no messages", async () => {
    await patch({ temporary: true });
    expect(db.conversation.updateMany.mock.calls[0][0].where).toEqual({ id: "c1", userId: "user-1", messages: { none: {} } });
  });

  it("answers 409 when the chat already has messages", async () => {
    db.conversation.updateMany.mockResolvedValue({ count: 0 });
    db.conversation.findFirst.mockResolvedValue({ id: "c1" });
    expect((await patch({ temporary: true })).status).toBe(409);
  });

  it("answers 404 when the chat is not the user's", async () => {
    db.conversation.updateMany.mockResolvedValue({ count: 0 });
    db.conversation.findFirst.mockResolvedValue(null);
    expect((await patch({ temporary: true })).status).toBe(404);
  });

  it("lets it be turned off without the message check", async () => {
    await patch({ temporary: false });
    expect(db.conversation.updateMany.mock.calls[0][0].where).toEqual({ id: "c1", userId: "user-1" });
  });

  it("rejects a non-boolean memoryDisabled value", async () => {
    expect((await patch({ memoryDisabled: "yes" })).status).toBe(400);
    expect(db.conversation.updateMany).not.toHaveBeenCalled();
  });

  it("accepts a boolean memoryDisabled value", async () => {
    expect((await patch({ memoryDisabled: true })).status).toBe(200);
    expect(db.conversation.updateMany.mock.calls[0][0].data).toEqual({ memoryDisabled: true });
  });
});

describe("DELETE /api/conversations/[id]", () => {
  beforeEach(() => {
    db.conversation.deleteMany.mockResolvedValue({ count: 1 });
  });

  it("with ?temporary=1 only ever deletes a temporary chat", async () => {
    db.conversation.findFirst.mockResolvedValue({ temporary: true });
    await del("?temporary=1");
    expect(db.conversation.deleteMany).toHaveBeenCalledWith({ where: { id: "c1", userId: "user-1", temporary: true } });
    expect(db.trace.deleteMany).toHaveBeenCalledWith({ where: { conversationId: { in: ["c1"] } } });
  });

  it("with ?temporary=1 leaves a chat that is no longer temporary alone", async () => {
    db.conversation.findFirst.mockResolvedValue(null);
    db.conversation.deleteMany.mockResolvedValue({ count: 0 });
    expect((await del("?temporary=1")).status).toBe(404);
    expect(db.trace.deleteMany).not.toHaveBeenCalled();
  });

  it("without the param still deletes any of the user's chats", async () => {
    db.conversation.findFirst.mockResolvedValue({ temporary: false });
    await del();
    expect(db.conversation.deleteMany).toHaveBeenCalledWith({ where: { id: "c1", userId: "user-1" } });
    expect(db.trace.deleteMany).not.toHaveBeenCalled();
  });
});

describe("resolveChatSettings", () => {
  const opts = {
    userId: "user-1",
    conversationId: "c1",
    bodyModel: undefined,
    bodySystemPrompt: undefined,
    bodyTemperature: undefined,
    bodyKbId: undefined,
    bodySearchProvider: "duckduckgo",
    bodyEnabledTools: [],
    bodyEnabledSkills: [],
    bodyChatOnlyMode: undefined,
    bodyMemoryDisabled: false,
    bodyAutoCompressThreshold: undefined,
    bodyMaxToolCalls: undefined,
  };

  it("turns memory off for a temporary chat whatever the Memory toggle says", async () => {
    db.conversation.findUnique.mockResolvedValue({ memoryDisabled: false, temporary: true });
    expect((await resolveChatSettings(opts)).memoryDisabled).toBe(true);
  });

  it("leaves memory on for an ordinary chat", async () => {
    db.conversation.findUnique.mockResolvedValue({ memoryDisabled: false, temporary: false });
    expect((await resolveChatSettings(opts)).memoryDisabled).toBe(false);
  });
});
