import { describe, it, expect } from "vitest";
import { chunkText, cosineSimilarity, simpleEmbed } from "@/lib/rag";

describe("chunkText", () => {
  it("handles empty text gracefully", () => {
    const result = chunkText("");
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("");
  });

  it("returns single chunk for short text", () => {
    const result = chunkText("hello world");
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("hello world");
  });

  it("splits text into multiple chunks when exceeding chunk size", () => {
    const words = Array.from({ length: 200 }, (_, i) => `word${i}`);
    const text = words.join(" ");
    const result = chunkText(text, 50, 10);
    expect(result.length).toBeGreaterThan(1);
  });

  it("preserves all words across chunks", () => {
    const words = Array.from({ length: 100 }, (_, i) => `w${i}`);
    const text = words.join(" ");
    const result = chunkText(text, 50, 10);
    const allWords = result.join(" ").split(/\s+/);
    const uniqueInResult = new Set(allWords);
    words.forEach((w) => expect(uniqueInResult.has(w)).toBe(true));
  });

  it("handles overlap correctly", () => {
    const words = Array.from({ length: 50 }, (_, i) => `word${i}`);
    const text = words.join(" ");
    const result = chunkText(text, 20, 10);
    if (result.length > 1) {
      const firstChunkWords = result[0].split(/\s+/);
      const secondChunkWords = result[1].split(/\s+/);
      const overlap = firstChunkWords.filter((w) =>
        secondChunkWords.includes(w),
      );
      expect(overlap.length).toBeGreaterThan(0);
    }
  });

  it("handles single word", () => {
    expect(chunkText("hello")).toEqual(["hello"]);
  });

  it("returns one chunk for text that exactly fills one chunk", () => {
    const text = "word";
    const result = chunkText(text, 1000, 10);
    expect(result).toHaveLength(1);
  });
});

describe("simpleEmbed", () => {
  it("returns an array of length 384", () => {
    const result = simpleEmbed("hello world");
    expect(result).toHaveLength(384);
  });

  it("returns normalized values between -1 and 1", () => {
    const result = simpleEmbed("test");
    result.forEach((v) => {
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    });
  });

  it("returns deterministic output for same input", () => {
    const a = simpleEmbed("hello world");
    const b = simpleEmbed("hello world");
    expect(a).toEqual(b);
  });

  it("returns different embedding for different text", () => {
    const a = simpleEmbed("hello world");
    const b = simpleEmbed("goodbye world");
    expect(a).not.toEqual(b);
  });

  it("handles empty string", () => {
    const result = simpleEmbed("");
    expect(result).toHaveLength(384);
    result.forEach((v) => expect(v).toBe(0));
  });

  it("handles very long string", () => {
    const long = "a".repeat(10000);
    const result = simpleEmbed(long);
    expect(result).toHaveLength(384);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const v = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 10);
  });

  it("returns 0 for orthogonal vectors", () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 10);
  });

  it("returns 0 for zero vectors", () => {
    const a = [0, 0, 0];
    const b = [1, 2, 3];
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it("handles empty vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("computes correct value for parallel vectors", () => {
    const a = [2, 4, 6];
    const b = [1, 2, 3];
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeCloseTo(1, 10);
  });

  it("computes correct cosine value", () => {
    const a = [1, 0];
    const b = [1, 1];
    const expected = 1 / Math.sqrt(2);
    expect(cosineSimilarity(a, b)).toBeCloseTo(expected, 10);
  });

  it("handles real embedding vectors", () => {
    const a = simpleEmbed("hello world");
    const b = simpleEmbed("hello world");
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });
});
