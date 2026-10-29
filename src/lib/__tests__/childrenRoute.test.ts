import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/conversations/[id]/children/route";

vi.mock("@/lib/db", () => {
  const prisma: any = {
    conversation: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    // Runs the callback against the same mocks, as the interactive transaction would.
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  return { prisma };
});
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn().mockResolvedValue("user-1") }));

import { prisma } from "@/lib/db";
const db = prisma as any;

const ctx = { params: Promise.resolve({ id: "main-1" }) };
const get = (query = "") =>
  GET(new NextRequest(`http://localhost/api/conversations/main-1/children${query}`), ctx);
const post = (body: unknown = {}) =>
  POST(new Request("http://localhost/api/conversations/main-1/children", { method: "POST", body: JSON.stringify(body) }) as any, ctx);

beforeEach(() => {
  vi.clearAllMocks();
  db.conversation.findFirst.mockResolvedValue({ id: "main-1", kind: "main", model: "gpt-4o" });
});

describe("POST /api/conversations/[id]/children", () => {
  it("answers 404 for a chat that is not the user's", async () => {
    db.conversation.findFirst.mockResolvedValue(null);
    expect((await post()).status).toBe(404);
    expect(db.conversation.findFirst.mock.calls[0][0].where).toEqual({ id: "main-1", userId: "user-1" });
    expect(db.conversation.create).not.toHaveBeenCalled();
  });

  it("refuses a side chat as the parent", async () => {
    db.conversation.findFirst.mockResolvedValue({ id: "main-1", kind: "side", model: "gpt-4o" });
    expect((await post()).status).toBe(400);
    expect(db.conversation.create).not.toHaveBeenCalled();
  });

  it("creates a side chat for the same owner, on the parent's model by default", async () => {
    db.conversation.findFirst.mockResolvedValueOnce({ id: "main-1", kind: "main", model: "gpt-4o" }).mockResolvedValueOnce(null);
    db.conversation.create.mockResolvedValue({ id: "side-1" });
    const res = await post();
    expect(res.status).toBe(201);
    expect(db.conversation.create.mock.calls[0][0].data).toEqual({
      userId: "user-1",
      parentId: "main-1",
      kind: "side",
      model: "gpt-4o",
    });
  });

  it("uses the model the body asks for", async () => {
    db.conversation.findFirst.mockResolvedValueOnce({ id: "main-1", kind: "main", model: "gpt-4o" }).mockResolvedValueOnce(null);
    db.conversation.create.mockResolvedValue({ id: "side-1" });
    await post({ model: "claude-x" });
    expect(db.conversation.create.mock.calls[0][0].data.model).toBe("claude-x");
  });

  it("returns the newest side chat instead of a new one while it is still empty", async () => {
    const empty = { id: "side-1", _count: { messages: 0 } };
    db.conversation.findFirst.mockResolvedValueOnce({ id: "main-1", kind: "main", model: "gpt-4o" }).mockResolvedValueOnce(empty);
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(empty);
    expect(db.conversation.create).not.toHaveBeenCalled();
  });

  it("starts a new side chat when the newest one already has messages", async () => {
    db.conversation.findFirst
      .mockResolvedValueOnce({ id: "main-1", kind: "main", model: "gpt-4o" })
      .mockResolvedValueOnce({ id: "side-old", _count: { messages: 4 } });
    db.conversation.create.mockResolvedValue({ id: "side-new" });
    expect((await post()).status).toBe(201);
    expect(db.conversation.create).toHaveBeenCalled();
  });
});

describe("GET /api/conversations/[id]/children", () => {
  it("answers 404 for a chat that is not the user's", async () => {
    db.conversation.findFirst.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect(db.conversation.findMany).not.toHaveBeenCalled();
  });

  it("lists this parent's side chats of this user, newest first", async () => {
    db.conversation.findMany.mockResolvedValue([{ id: "side-2" }, { id: "side-1" }]);
    const res = await get();
    expect(await res.json()).toEqual([{ id: "side-2" }, { id: "side-1" }]);
    const args = db.conversation.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ parentId: "main-1", userId: "user-1", kind: "side" });
    expect(args.orderBy).toEqual({ createdAt: "desc" });
  });

  it("refuses an unknown kind", async () => {
    expect((await get("?kind=main")).status).toBe(400);
    expect(db.conversation.findMany).not.toHaveBeenCalled();
  });
});

describe("POST side chat is one transaction", () => {
  it("runs the find and the create inside $transaction", async () => {
    db.conversation.findFirst.mockResolvedValueOnce({ id: "main-1", kind: "main", model: "gpt-4o" }).mockResolvedValueOnce(null);
    db.conversation.create.mockResolvedValue({ id: "side-1" });
    await post();
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: "Serializable" });
  });
});
