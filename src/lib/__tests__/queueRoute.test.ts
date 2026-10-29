import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/conversations/[id]/queue/route";

vi.mock("@/lib/db", () => ({
  prisma: { queuedMessage: { findUnique: vi.fn(), create: vi.fn() } },
}));
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn().mockResolvedValue("user-1") }));
vi.mock("@/lib/api/conversations", () => ({ getConversationOrNull: vi.fn().mockResolvedValue({ id: "c1" }) }));

import { prisma } from "@/lib/db";
const db = prisma as any;

const ctx = { params: Promise.resolve({ id: "c1" }) };
const post = (body: unknown) =>
  POST(new Request("http://localhost/api/conversations/c1/queue", { method: "POST", body: JSON.stringify(body) }) as any, ctx);
const sender = { from: "side", fromConversationId: "s1", fromTitle: "Side chat", hop: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  db.queuedMessage.findUnique.mockResolvedValue(null);
  db.queuedMessage.create.mockResolvedValue({});
});

describe("POST /api/conversations/[id]/queue with agent", () => {
  it("queues a message from another chat with its sender", async () => {
    const res = await post({ id: "q1", seq: 3, text: "check this", agent: sender });
    expect(res.status).toBe(200);
    expect(db.queuedMessage.create.mock.calls[0][0].data).toEqual({
      id: "q1",
      conversationId: "c1",
      text: "check this",
      seq: 3,
      agent: JSON.stringify(sender),
    });
  });

  it("queues the user's own message with no sender", async () => {
    const res = await post({ id: "q2", seq: 4, text: "hello" });
    expect(res.status).toBe(200);
    expect(db.queuedMessage.create.mock.calls[0][0].data.agent).toBeNull();
  });

  it("refuses a sender past the hop limit", async () => {
    const res = await post({ id: "q3", seq: 5, text: "one more", agent: { ...sender, hop: 4 } });
    expect(res.status).toBe(400);
    expect(db.queuedMessage.create).not.toHaveBeenCalled();
  });

  it("refuses a malformed sender", async () => {
    const res = await post({ id: "q4", seq: 6, text: "hi", agent: { from: "side", hop: 1 } });
    expect(res.status).toBe(400);
    expect(db.queuedMessage.create).not.toHaveBeenCalled();
  });
});
