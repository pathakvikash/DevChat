import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UIMessageChunk } from "ai";

vi.mock("@/lib/db", () => ({
  prisma: { queuedMessage: { updateMany: vi.fn(), findMany: vi.fn() } },
}));

import { prisma } from "@/lib/db";
import {
  claimQueued,
  releaseUnshown,
  withInjected,
  queuedMarkerTransform,
  type QueuedMarker,
} from "@/lib/chat/queue";

const db = prisma as any;
const user = (text: string) => ({ role: "user" as const, content: text });
const asst = (text: string) => ({ role: "assistant" as const, content: text });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("withInjected", () => {
  it("keeps each injected message in place as later responses are appended", () => {
    const base = [user("q"), asst("step 1 call"), asst("step 2 answer")];
    const out = withInjected(base, [{ at: 2, message: user("fix that") }]);
    expect(out).toEqual([base[0], base[1], user("fix that"), base[2]]);
  });

  it("places injections from two steps in their own order", () => {
    const base = [user("q"), asst("a"), asst("b"), asst("c"), asst("d")];
    const out = withInjected(base, [
      { at: 1, message: user("first") },
      { at: 3, message: user("second") },
    ]);
    expect(out.map((m) => m.content)).toEqual(["q", "first", "a", "b", "second", "c", "d"]);
  });

  it("returns the input unchanged when nothing was injected", () => {
    const base = [user("q")];
    expect(withInjected(base, [])).toBe(base);
  });
});

describe("claimQueued", () => {
  it("claims the undelivered rows with one token, then reads back the rows that carry it in client order", async () => {
    db.queuedMessage.updateMany.mockResolvedValue({ count: 2 });
    db.queuedMessage.findMany.mockResolvedValue([{ id: "q1", text: "a", agent: null }, { id: "q2", text: "b", agent: null }]);

    const claimed = await claimQueued("c1");

    const token = db.queuedMessage.updateMany.mock.calls[0][0].data.claimToken;
    expect(token).toEqual(expect.any(String));
    expect(db.queuedMessage.updateMany).toHaveBeenCalledWith({
      where: { conversationId: "c1", deliveredAt: null },
      data: { deliveredAt: expect.any(Date), claimToken: token },
    });
    expect(db.queuedMessage.findMany).toHaveBeenCalledWith({
      where: { conversationId: "c1", claimToken: token },
      orderBy: { seq: "asc" },
      select: { id: true, text: true, agent: true },
    });
    expect(claimed).toEqual([{ id: "q1", text: "a", agent: null }, { id: "q2", text: "b", agent: null }]);
  });

  it("reads only its own rows when two claims share a timestamp", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-10-30T10:00:00Z"));
    try {
      db.queuedMessage.updateMany.mockResolvedValue({ count: 1 });
      db.queuedMessage.findMany.mockResolvedValue([]);
      await claimQueued("c1");
      await claimQueued("c1");
      const [first, second] = db.queuedMessage.updateMany.mock.calls.map((c: any) => c[0].data);
      expect(first.deliveredAt).toEqual(second.deliveredAt);
      expect(first.claimToken).not.toBe(second.claimToken);
      expect(db.queuedMessage.findMany.mock.calls[1][0].where).toEqual({
        conversationId: "c1",
        claimToken: second.claimToken,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("puts the rows back and rethrows when the read after the claim fails", async () => {
    db.queuedMessage.updateMany.mockResolvedValue({ count: 1 });
    db.queuedMessage.findMany.mockRejectedValue(new Error("db down"));

    await expect(claimQueued("c1")).rejects.toThrow("db down");

    const token = db.queuedMessage.updateMany.mock.calls[0][0].data.claimToken;
    expect(db.queuedMessage.updateMany).toHaveBeenLastCalledWith({
      where: { conversationId: "c1", claimToken: token },
      data: { deliveredAt: null, claimToken: null },
    });
  });

  it("makes one call and returns nothing when the queue is empty", async () => {
    db.queuedMessage.updateMany.mockResolvedValue({ count: 0 });

    expect(await claimQueued("c1")).toEqual([]);
    expect(db.queuedMessage.updateMany).toHaveBeenCalledOnce();
    expect(db.queuedMessage.findMany).not.toHaveBeenCalled();
  });
});

describe("queuedMarkerTransform", () => {
  async function run(chunks: UIMessageChunk[], pending: QueuedMarker[]) {
    const source = new ReadableStream<UIMessageChunk>({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        controller.close();
      },
    });
    const out: UIMessageChunk[] = [];
    const reader = source.pipeThrough(queuedMarkerTransform(pending)).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out.push(value);
    }
    return out;
  }

  it("writes a pending marker right before the next start-step", async () => {
    const marker: QueuedMarker = {
      type: "data-queued-message",
      id: "q1",
      data: { queuedId: "q1", text: "change course" },
    };
    const pending: QueuedMarker[] = [];
    const transform = queuedMarkerTransform(pending);
    const writer = transform.writable.getWriter();
    const reader = transform.readable.getReader();
    const seen: UIMessageChunk[] = [];
    const reading = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        seen.push(value);
      }
    })();

    await writer.write({ type: "start-step" } as UIMessageChunk);
    await writer.write({ type: "text-delta", id: "1", delta: "one" } as UIMessageChunk);
    await writer.write({ type: "finish-step" } as UIMessageChunk);
    pending.push(marker); // prepareStep runs before the next step starts
    await writer.write({ type: "start-step" } as UIMessageChunk);
    await writer.write({ type: "text-delta", id: "2", delta: "two" } as UIMessageChunk);
    await writer.close();
    await reading;

    expect(seen.map((c) => c.type)).toEqual([
      "start-step",
      "text-delta",
      "finish-step",
      "data-queued-message",
      "start-step",
      "text-delta",
    ]);
    expect(seen[3]).toEqual(marker);
    expect(pending).toEqual([]);
  });

  it("passes chunks through unchanged when nothing is pending", async () => {
    const chunks = [
      { type: "start-step" },
      { type: "text-delta", id: "1", delta: "hi" },
    ] as UIMessageChunk[];
    expect(await run(chunks, [])).toEqual(chunks);
  });
});

describe("releaseUnshown", () => {
  const marker = (id: string) => ({ type: "data-queued-message", id, data: { queuedId: id, text: id } });

  it("puts back the claimed messages whose marker never reached the reply", async () => {
    await releaseUnshown(["q1", "q2"], [{ type: "text", text: "hi" }, marker("q1")]);

    expect(db.queuedMessage.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: { in: ["q2"] } },
      data: { deliveredAt: null, claimToken: null },
    });
  });

  it("releases every claimed message when the reply was aborted before any marker was saved", async () => {
    await releaseUnshown(["q1"], []);

    expect(db.queuedMessage.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: { in: ["q1"] } },
      data: { deliveredAt: null, claimToken: null },
    });
  });

  it("leaves delivered messages alone and makes no call when all markers were saved", async () => {
    await releaseUnshown(["q1"], [marker("q1")]);
    await releaseUnshown([], []);

    expect(db.queuedMessage.updateMany).not.toHaveBeenCalled();
  });
});

