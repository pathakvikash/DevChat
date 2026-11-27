import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    conversation: {
      findMany: vi.fn(async () => [
        { model: "openai/gpt-4o", totalTokens: 3000, messages: [{ inputTokens: 1000, outputTokens: 2000 }] },
        { model: "ollama/llama3", totalTokens: 10, messages: [{ inputTokens: 5, outputTokens: 5 }] },
        { model: "mystery/unpriced", totalTokens: 10, messages: [{ inputTokens: 5, outputTokens: 5 }] },
      ]),
    },
    message: { count: vi.fn(async () => 0) },
  },
}));
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn().mockResolvedValue("u1") }));

import { GET } from "@/app/api/analytics/route";

describe("GET /api/analytics", () => {
  it("prices a known model from the observability table, and unknown ones as $0", async () => {
    const stats = await (await GET()).json();
    // gpt-4o: 1k in * 0.005 + 2k out * 0.015
    expect(stats.estimatedCost).toBeCloseTo(0.035);
  });
});
