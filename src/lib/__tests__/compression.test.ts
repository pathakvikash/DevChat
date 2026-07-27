import { describe, it, expect, vi, beforeEach } from "vitest";
import { shouldAutoCompress } from "@/lib/compression";

vi.mock("@/lib/db", () => ({
  prisma: {
    conversation: {
      findUnique: vi.fn(),
    },
    message: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/tokens", () => ({
  calculateContextUsage: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { calculateContextUsage } from "@/lib/tokens";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("shouldAutoCompress", () => {
  it("returns false when conversation not found", async () => {
    (prisma.conversation.findUnique as any).mockResolvedValue(null);
    const result = await shouldAutoCompress("nonexistent-id");
    expect(result).toBe(false);
  });

  it("returns false when usage is below threshold", async () => {
    (prisma.conversation.findUnique as any).mockResolvedValue({
      contextLength: 8192,
      model: "test-model",
      systemPrompt: "system prompt",
    });
    (prisma.message.findMany as any).mockResolvedValue([
      { role: "user", content: "hello" },
    ]);
    (calculateContextUsage as any).mockResolvedValue({
      contextPercent: 50,
      usedTokens: 100,
      maxContextTokens: 8192,
    });

    const result = await shouldAutoCompress("conv-id", 85);
    expect(result).toBe(false);
  });

  it("returns true when usage is above threshold", async () => {
    (prisma.conversation.findUnique as any).mockResolvedValue({
      contextLength: 8192,
      model: "test-model",
      systemPrompt: "system prompt",
    });
    (prisma.message.findMany as any).mockResolvedValue(
      Array.from({ length: 100 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: "this is a message that takes up tokens ".repeat(20),
      })),
    );
    (calculateContextUsage as any).mockResolvedValue({
      contextPercent: 90,
      usedTokens: 7500,
      maxContextTokens: 8192,
    });

    const result = await shouldAutoCompress("conv-id", 85);
    expect(result).toBe(true);
  });

  it("returns false for very short conversations", async () => {
    (prisma.conversation.findUnique as any).mockResolvedValue({
      contextLength: 8192,
      model: "test-model",
      systemPrompt: "system prompt",
    });
    (prisma.message.findMany as any).mockResolvedValue([
      { role: "user", content: "hi" },
    ]);
    (calculateContextUsage as any).mockResolvedValue({
      contextPercent: 5,
      usedTokens: 50,
      maxContextTokens: 8192,
    });

    const result = await shouldAutoCompress("conv-id", 85);
    expect(result).toBe(false);
  });

  it("uses default context length when conversation has none", async () => {
    (prisma.conversation.findUnique as any).mockResolvedValue({
      contextLength: null,
      model: "test-model",
      systemPrompt: null,
    });
    (prisma.message.findMany as any).mockResolvedValue([]);
    (calculateContextUsage as any).mockResolvedValue({
      contextPercent: 0,
      usedTokens: 0,
      maxContextTokens: 8192,
    });

    const result = await shouldAutoCompress("conv-id");
    expect(result).toBe(false);
  });
});
