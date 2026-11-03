import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { DELETE } from "@/app/api/conversations/[id]/messages/route";

vi.mock("@/lib/db", () => {
  const prisma: any = {
    conversation: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    message: { findFirst: vi.fn(), deleteMany: vi.fn() },
    // Runs the queued operations, as the array form of the transaction would.
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return { prisma };
});
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn().mockResolvedValue("user-1") }));

import { prisma } from "@/lib/db";
const db = prisma as any;

const ctx = { params: Promise.resolve({ id: "c1" }) };
const delRaw = (raw?: string, query = "") =>
  DELETE(new NextRequest(`http://localhost/api/conversations/c1/messages${query}`, { method: "DELETE", body: raw }), ctx);
const del = (body?: unknown, query = "") => delRaw(body === undefined ? undefined : JSON.stringify(body), query);

const cut = new Date("2026-11-01T00:00:02Z");
const nulls = {
  compressedSummary: null,
  compressedAt: null,
  compressedBeforeTokens: null,
  compressedAfterTokens: null,
  compressedBeforeMessages: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.conversation.findUnique.mockResolvedValue({ id: "c1", userId: "user-1" });
  // The earliest saved row among the ids; "client-1" below has none.
  db.message.findFirst.mockResolvedValue({ createdAt: cut });
  db.message.deleteMany.mockResolvedValue({ count: 2 });
  db.conversation.updateMany.mockResolvedValue({ count: 0 });
});

describe("DELETE /api/conversations/[id]/messages with fromIds", () => {
  it("cuts at the earliest saved id when the first one has no row", async () => {
    const res = await del({ fromIds: ["client-1", "m2", "m3"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, deletedMessages: 2 });
    expect(db.message.findFirst).toHaveBeenCalledWith({
      where: { conversationId: "c1", id: { in: ["client-1", "m2", "m3"] } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    expect(db.message.deleteMany).toHaveBeenCalledWith({
      where: { conversationId: "c1", createdAt: { gte: cut } },
    });
  });

  it("succeeds without deleting when none of the ids has a row", async () => {
    db.message.findFirst.mockResolvedValue(null);
    const res = await del({ fromIds: ["client-1"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, deletedMessages: 0 });
    expect(db.message.deleteMany).not.toHaveBeenCalled();
  });

  it("clears the compression fields in the same transaction, only for a conversation compressed after the cut", async () => {
    await del({ fromIds: ["m2", "m3"] });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: "c1", compressedAt: { gt: cut } },
      data: nulls,
    });
  });

  it("answers 400 unless it is told what to delete, and never clears the chat", async () => {
    const bad = [undefined, null, {}, [], "x", 0, { fromIDs: ["m1"] }, { fromIds: [] }, { fromIds: "m1" }, { fromIds: [1] }];
    for (const body of bad) expect((await del(body)).status, JSON.stringify(body)).toBe(400);
    expect((await delRaw("{oops")).status).toBe(400);
    expect(db.message.deleteMany).not.toHaveBeenCalled();
    expect(db.conversation.update).not.toHaveBeenCalled();
  });

  it("answers 404 for a chat that is not the user's", async () => {
    db.conversation.findUnique.mockResolvedValue(null);
    expect((await del({ fromIds: ["m1"] })).status).toBe(404);
  });
});

describe("DELETE /api/conversations/[id]/messages?all=1", () => {
  it("wipes the chat and resets compression and the token total", async () => {
    const res = await del(undefined, "?all=1");
    expect(res.status).toBe(200);
    expect(db.message.deleteMany).toHaveBeenCalledWith({ where: { conversationId: "c1" } });
    expect(db.conversation.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { ...nulls, totalTokens: 0 },
    });
  });
});
