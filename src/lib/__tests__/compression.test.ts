import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateText } from "ai";
import { compressConversation, saveCompressedSummary, shouldAutoCompress } from "@/lib/compression";

vi.mock("@/lib/db", () => ({
  prisma: {
    conversation: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    message: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/tokens", () => ({
  calculateContextUsage: vi.fn(),
  countTokens: vi.fn(() => 10),
}));

vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("@/lib/models", () => ({
  getModel: vi.fn(() => ({ model: "m" })),
  initializeOllamaModels: vi.fn(),
}));
vi.mock("@/lib/apiKeys", () => ({ resolveProviderCreds: vi.fn(async () => ({})) }));

import { prisma } from "@/lib/db";
import { getModel } from "@/lib/models";
import { calculateContextUsage, countTokens } from "@/lib/tokens";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("shouldAutoCompress", () => {
  it("returns false when conversation not found", async () => {
    (prisma.conversation.findUnique as any).mockResolvedValue(null);
    const result = await shouldAutoCompress("nonexistent-id", 85, 8192);
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

    const result = await shouldAutoCompress("conv-id", 85, 8192);
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

    const result = await shouldAutoCompress("conv-id", 85, 8192);
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

    const result = await shouldAutoCompress("conv-id", 85, 8192);
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

    const result = await shouldAutoCompress("conv-id", 85, 8192);
    expect(result).toBe(false);
  });

  it("counts only messages from compressedAt on, plus the summary", async () => {
    const compressedAt = new Date("2024-06-01T12:00:00Z");
    const rows = [
      { role: "user", content: "old q", createdAt: new Date("2024-06-01T11:00:00Z") },
      { role: "assistant", content: "old a", createdAt: new Date("2024-06-01T11:01:00Z") },
      { role: "user", content: "kept q", createdAt: compressedAt },
      { role: "assistant", content: "kept a", createdAt: new Date("2024-06-01T12:01:00Z") },
      { role: "user", content: "new q", createdAt: new Date("2024-06-01T12:02:00Z") },
      { role: "assistant", content: "new a", createdAt: new Date("2024-06-01T12:03:00Z") },
    ];
    (prisma.conversation.findUnique as any).mockResolvedValue({
      model: "test-model",
      systemPrompt: "sys",
      compressedAt,
      compressedSummary: "the summary",
    });
    // Honour the `createdAt >= compressedAt` filter like the database would.
    (prisma.message.findMany as any).mockImplementation(async ({ where }: any) =>
      rows.filter((r) => !where.createdAt?.gte || r.createdAt >= where.createdAt.gte),
    );
    (calculateContextUsage as any).mockResolvedValue({ contextPercent: 10 });

    await shouldAutoCompress("conv-id", 85, 8192);

    const [, systemPrompt, messages] = (calculateContextUsage as any).mock.calls.at(-1);
    expect(messages.map((m: any) => m.content)).toEqual(["kept q", "kept a", "new q", "new a"]);
    expect(systemPrompt).toContain("the summary");
  });

  it("returns false when the only user message left is the cut point, nothing to drop", async () => {
    (prisma.conversation.findUnique as any).mockResolvedValue({
      model: "test-model",
      systemPrompt: "sys",
      compressedAt: new Date("2024-06-01T12:00:00Z"),
      compressedSummary: "the summary",
    });
    (prisma.message.findMany as any).mockResolvedValue([
      { role: "user", content: "huge pasted file" },
      { role: "assistant", content: "answer" },
    ]);
    (calculateContextUsage as any).mockResolvedValue({ contextPercent: 99 });

    expect(await shouldAutoCompress("conv-id", 85, 8192)).toBe(false);
  });
});

describe("shouldAutoCompress context window", () => {
  it("measures against the window it is given, not 4096", async () => {
    (prisma.conversation.findUnique as any).mockResolvedValue({
      model: "anthropic/big",
      systemPrompt: "sys",
    });
    (prisma.message.findMany as any).mockResolvedValue([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ]);
    // 5000 tokens used: 122% of 4096, 2.5% of 200k.
    (calculateContextUsage as any).mockImplementation(async (...a: any[]) => ({ contextPercent: (5000 / a[4]) * 100 }));

    expect(await shouldAutoCompress("conv-id", 85, 200_000)).toBe(false);
    expect((calculateContextUsage as any).mock.calls.at(-1)[4]).toBe(200_000);
  });
});

describe("saveCompressedSummary", () => {
  it("keeps the latest exchange live by cutting at the cut point it is given", async () => {
    const cutAt = new Date("2024-06-01T12:00:00Z");

    await saveCompressedSummary("conv-id", "summary", undefined, cutAt);

    expect((prisma.conversation.updateMany as any).mock.calls[0][0].data.compressedAt).toBe(cutAt);
    expect(prisma.message.findFirst).not.toHaveBeenCalled();
  });

  it("does not move compressedAt backwards when an older cut lands late", async () => {
    const newer = new Date("2024-06-01T12:00:00Z");
    let stored: Date | null = newer;
    (prisma.conversation.updateMany as any).mockImplementation(async ({ where, data }: any) => {
      const applies = where.OR.some((cond: any) =>
        cond.compressedAt === null ? stored === null : stored !== null && stored <= cond.compressedAt.lte,
      );
      if (applies) stored = data.compressedAt;
      return { count: applies ? 1 : 0 };
    });

    await saveCompressedSummary("conv-id", "stale summary", undefined, new Date("2024-06-01T11:00:00Z"));

    expect(stored).toBe(newer);
  });

  it("falls back to now when there is no cut point", async () => {
    await saveCompressedSummary("conv-id", "summary");

    expect((prisma.conversation.update as any).mock.calls[0][0].data.compressedAt).toBeInstanceOf(Date);
  });
});

describe("compressConversation", () => {
  const at = (iso: string) => new Date(iso);
  const exchange = (n: number, hour: number) => [
    { role: "user", content: `q${n}`, createdAt: at(`2024-06-01T${hour}:00:00Z`) },
    { role: "assistant", content: `a${n}`, createdAt: at(`2024-06-01T${hour}:01:00Z`) },
  ];
  const conversation = (extra: object = {}) => ({
    userId: null,
    compressedAt: null,
    compressedSummary: null,
    messages: [...exchange(1, 10), ...exchange(2, 11), ...exchange(3, 12)],
    ...extra,
  });
  const promptSent = () => (generateText as any).mock.calls[0][0].prompt as string;

  beforeEach(() => {
    (prisma.conversation.findUnique as any).mockResolvedValue(conversation());
    (generateText as any).mockResolvedValue({ text: "summary" });
    (countTokens as any).mockImplementation(() => 10);
  });

  it("bounds the call with a timeout and no retries, and keeps the default retries without one", async () => {
    await compressConversation("conv-id", "ollama/x", { timeoutMs: 1000 });
    await compressConversation("conv-id", "ollama/x");

    const [bounded, unbounded] = (generateText as any).mock.calls.map((c: any[]) => c[0]);
    expect(bounded.abortSignal).toBeInstanceOf(AbortSignal);
    expect(bounded.maxRetries).toBe(0);
    expect(unbounded.abortSignal).toBeUndefined();
    expect(unbounded.maxRetries).toBeUndefined();
  });

  it("returns the last user message of the snapshot as the cut point", async () => {
    const result = await compressConversation("conv-id", "ollama/x");

    expect(result?.cutAt).toEqual(at("2024-06-01T12:00:00Z"));
  });

  it("summarizes only what is before the cut, so the live last exchange is not also in the summary", async () => {
    const result = await compressConversation("conv-id", "ollama/x");

    expect(promptSent()).toContain("USER: q1\n\nASSISTANT: a1\n\nUSER: q2\n\nASSISTANT: a2");
    expect(promptSent()).not.toContain("q3");
    expect(promptSent()).not.toContain("a3");
    expect(result?.beforeMessages).toBe(4);
  });

  it("feeds the earlier summary first, then the messages since it that are before the cut", async () => {
    (prisma.conversation.findUnique as any).mockResolvedValue(
      conversation({ compressedAt: at("2024-06-01T11:00:00Z"), compressedSummary: "old facts" }),
    );

    await compressConversation("conv-id", "ollama/x");

    expect(promptSent()).toContain("Earlier summary:\nold facts\n\nUSER: q2\n\nASSISTANT: a2");
    expect(promptSent()).not.toContain("q1");
    expect(promptSent()).not.toContain("q3");
  });

  it("returns null when there is nothing before the cut to summarize", async () => {
    (prisma.conversation.findUnique as any).mockResolvedValue(conversation({ messages: exchange(1, 10) }));

    expect(await compressConversation("conv-id", "ollama/x")).toBeNull();
    expect(generateText).not.toHaveBeenCalled();
  });

  it("over the token cap drops the oldest messages, never the earlier summary", async () => {
    (countTokens as any).mockImplementation((text: string) => text.length);
    (prisma.conversation.findUnique as any).mockResolvedValue(
      conversation({
        compressedSummary: "old facts",
        messages: [...exchange(1, 10), ...exchange(2, 11), ...exchange(3, 12)].map((m) => ({
          ...m,
          content: `${m.content} ${"x".repeat(1500)}`,
        })),
      }),
    );

    await compressConversation("conv-id", "ollama/x");

    expect(promptSent()).toContain("old facts");
    expect(promptSent()).not.toContain("q1 ");
    expect(promptSent()).toContain("a2 ");
  });
});

describe("compressConversation focus", () => {
  beforeEach(() => {
    (prisma.conversation.findUnique as any).mockResolvedValue({
      userId: null,
      messages: [
        { role: "user", content: "setup", createdAt: new Date("2024-06-01T10:00:00Z") },
        { role: "assistant", content: "ok", createdAt: new Date("2024-06-01T10:01:00Z") },
        { role: "user", content: "which cache?", createdAt: new Date("2024-06-01T11:00:00Z") },
        { role: "assistant", content: "redis", createdAt: new Date("2024-06-01T11:01:00Z") },
      ],
    });
    (generateText as any).mockResolvedValue({ text: "### Goal\nPick a cache" });
  });

  const promptSent = () => (generateText as any).mock.calls[0][0].prompt as string;

  it("puts the focus into the compression prompt", async () => {
    await compressConversation("c1", "gpt-4o", { focus: "keep the API decisions" });
    expect(promptSent()).toContain("Pay special attention to: keep the API decisions");
  });

  it("leaves the prompt unchanged without a focus", async () => {
    await compressConversation("c1", "gpt-4o");
    expect(promptSent()).not.toContain("Pay special attention to");
    await compressConversation("c1", "gpt-4o", { focus: "   " });
    expect((generateText as any).mock.calls[1][0].prompt).toBe(promptSent());
  });

  it("cuts a focus longer than 500 characters", async () => {
    await compressConversation("c1", "gpt-4o", { focus: "x".repeat(600) });
    expect(promptSent()).toContain(`Pay special attention to: ${"x".repeat(500)}`);
    expect(promptSent()).not.toContain("x".repeat(501));
  });

  it("passes the abort signal on to the model call", async () => {
    const controller = new AbortController();
    await compressConversation("c1", "gpt-4o", { abortSignal: controller.signal });
    expect((generateText as any).mock.calls[0][0].abortSignal).toBe(controller.signal);
  });
});
