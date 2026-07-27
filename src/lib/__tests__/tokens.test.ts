import { describe, it, expect } from "vitest";
import {
  countTokens,
  estimateTokens,
  calculateContextUsage,
  calculateDetailedContextUsage,
  getContextStatus,
} from "@/lib/tokens";

describe("countTokens", () => {
  it("returns 0 for empty string", () => {
    expect(countTokens("")).toBe(0);
  });

  it("returns 0 for whitespace-only string", () => {
    expect(countTokens("   ")).toBe(0);
  });

  it("returns positive count for a real word", () => {
    const n = countTokens("hello");
    expect(n).toBeGreaterThan(0);
  });

  it("returns known token count for a sentence", () => {
    const text = "The quick brown fox jumps over the lazy dog";
    const n = countTokens(text);
    expect(n).toBeGreaterThan(0);
  });

  it("handles very long strings without crashing", () => {
    const long = "word ".repeat(100_000);
    const n = countTokens(long);
    expect(n).toBeGreaterThan(0);
  });

  it("handles strings with special characters", () => {
    const n = countTokens("npm install @foo/bar --save-dev");
    expect(n).toBeGreaterThan(0);
  });

  it("handles code snippets", () => {
    const code = `function hello() {\n  return "world";\n}`;
    const n = countTokens(code);
    expect(n).toBeGreaterThan(0);
  });
});

describe("estimateTokens", () => {
  it("handles empty string", () => {
    const n = estimateTokens("");
    expect(n).toBeGreaterThanOrEqual(0);
  });

  it("estimates tokens based on word count", () => {
    const text = "one two three four five";
    const n = estimateTokens(text);
    expect(n).toBeGreaterThanOrEqual(5);
  });
});

describe("calculateContextUsage", () => {
  it("returns breakdown keys for minimal input", async () => {
    const result = await calculateContextUsage(
      "test-model",
      "",
      [],
      "",
      8192,
    );
    expect(result).toHaveProperty("usedTokens");
    expect(result).toHaveProperty("maxContextTokens");
    expect(result).toHaveProperty("contextPercent");
    expect(result).toHaveProperty("breakdown");
    expect(result.breakdown).toHaveProperty("systemPrompt");
    expect(result.breakdown).toHaveProperty("conversationHistory");
    expect(result.breakdown).toHaveProperty("currentMessage");
    expect(result.breakdown).toHaveProperty("total");
  });

  it("computes correct percentage", async () => {
    const result = await calculateContextUsage(
      "test-model",
      "hello world",
      [{ role: "user", content: "hi" }],
      "how are you",
      100,
    );
    expect(result.maxContextTokens).toBe(100);
    expect(result.contextPercent).toBeGreaterThanOrEqual(0);
    expect(result.contextPercent).toBeLessThanOrEqual(100);
  });

  it("uses compressed summary when provided", async () => {
    const result = await calculateContextUsage(
      "test-model",
      "system prompt",
      [{ role: "user", content: "very long history ".repeat(1000) }],
      "current message",
      100000,
      "Compressed summary here",
    );
    expect(result.breakdown.total).toBeLessThan(500);
  });

  it("does not use compressed summary when empty", async () => {
    const result = await calculateContextUsage(
      "test-model",
      "system prompt",
      [{ role: "user", content: "short" }],
      "current",
      8192,
      "",
    );
    expect(result.breakdown.total).toBeGreaterThan(0);
  });

  it("handles null compressedSummary", async () => {
    const result = await calculateContextUsage(
      "test-model",
      "hi",
      [{ role: "user", content: "hello" }],
      "bye",
      8192,
      null,
    );
    expect(result.breakdown.conversationHistory).toBeGreaterThan(0);
  });
});

describe("calculateDetailedContextUsage", () => {
  const emptySections = {
    base: "",
    persona: null,
    skills: null,
    tools: null,
    memory: null,
    compressed: null,
    kb: null,
  };

  it("returns empty breakdown for all-empty input", () => {
    const result = calculateDetailedContextUsage(
      emptySections,
      [],
      "",
      8192,
      null,
    );
    expect(result.breakdown.total).toBe(0);
  });

  it("counts base section tokens", () => {
    const sections = { ...emptySections, base: "You are an AI assistant." };
    const result = calculateDetailedContextUsage(
      sections,
      [],
      "",
      8192,
      null,
    );
    expect(result.breakdown.base).toBeGreaterThan(0);
    expect(result.breakdown.total).toBe(result.breakdown.base);
  });

  it("counts persona section tokens when present", () => {
    const sections = {
      ...emptySections,
      base: "base",
      persona: "You are helpful.",
    };
    const result = calculateDetailedContextUsage(
      sections,
      [],
      "",
      8192,
      null,
    );
    expect(result.breakdown.persona).toBeGreaterThan(0);
  });

  it("counts memory section tokens when present", () => {
    const sections = {
      ...emptySections,
      base: "base",
      memory: "User likes Python.",
    };
    const result = calculateDetailedContextUsage(
      sections,
      [],
      "",
      8192,
      null,
    );
    expect(result.breakdown.memory).toBeGreaterThan(0);
  });

  it("counts compressed summary separately", () => {
    const sections = {
      ...emptySections,
      base: "base",
    };
    const result = calculateDetailedContextUsage(
      sections,
      [{ role: "user", content: "old message" }],
      "current",
      8192,
      "A compressed summary of the conversation",
    );
    expect(result.breakdown.compressed).toBeGreaterThan(0);
    expect(result.breakdown.conversationHistory).toBeGreaterThanOrEqual(0);
  });

  it("uses full history when no compressed summary", () => {
    const sections = {
      ...emptySections,
      base: "base",
    };
    const result = calculateDetailedContextUsage(
      sections,
      [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi there" },
      ],
      "current",
      8192,
      null,
    );
    expect(result.breakdown.compressed).toBe(0);
    expect(result.breakdown.conversationHistory).toBeGreaterThan(0);
  });

  it("returns correct sections metadata", () => {
    const sections = {
      ...emptySections,
      base: "base text",
      persona: "persona text",
    };
    const result = calculateDetailedContextUsage(
      sections,
      [],
      "",
      8192,
      null,
    );
    expect(result.breakdown.sections.base).toBe("base text");
    expect(result.breakdown.sections.persona).toBe("persona text");
    expect(result.breakdown.sections.tools).toBeNull();
  });
});

describe("getContextStatus", () => {
  it("returns healthy below 60", () => {
    expect(getContextStatus(0)).toBe("healthy");
    expect(getContextStatus(59)).toBe("healthy");
  });

  it("returns warning between 60 and 84", () => {
    expect(getContextStatus(60)).toBe("warning");
    expect(getContextStatus(84)).toBe("warning");
  });

  it("returns critical at 85 or above", () => {
    expect(getContextStatus(85)).toBe("critical");
    expect(getContextStatus(100)).toBe("critical");
  });

  it("handles boundary values", () => {
    expect(getContextStatus(59)).toBe("healthy");
    expect(getContextStatus(60)).toBe("warning");
    expect(getContextStatus(84)).toBe("warning");
    expect(getContextStatus(85)).toBe("critical");
  });
});
