import { describe, it, expect, vi, beforeEach } from "vitest";
import { recordTrace } from "@/lib/observability";

vi.mock("@/lib/db", () => ({
  prisma: {
    conversation: { findUnique: vi.fn() },
    trace: { create: vi.fn().mockResolvedValue({ id: "t1" }) },
    traceToolCall: { createMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
const db = prisma as any;

const obs = { model: "gpt-4o", promptTokens: 1, completionTokens: 1, latencyMs: 5, status: "success" as const };

beforeEach(() => vi.clearAllMocks());

describe("recordTrace", () => {
  it("records nothing for a temporary chat", async () => {
    db.conversation.findUnique.mockResolvedValue({ temporary: true });
    await recordTrace({ ...obs, conversationId: "c1" });
    expect(db.trace.create).not.toHaveBeenCalled();
  });

  it("records nothing for a chat that no longer exists", async () => {
    db.conversation.findUnique.mockResolvedValue(null);
    await recordTrace({ ...obs, conversationId: "gone" });
    expect(db.trace.create).not.toHaveBeenCalled();
  });

  it("records a trace for an ordinary chat", async () => {
    db.conversation.findUnique.mockResolvedValue({ temporary: false });
    await recordTrace({ ...obs, conversationId: "c1" });
    expect(db.trace.create).toHaveBeenCalledTimes(1);
  });

  it("still records one with no conversation", async () => {
    await recordTrace(obs);
    expect(db.trace.create).toHaveBeenCalledTimes(1);
  });
});
