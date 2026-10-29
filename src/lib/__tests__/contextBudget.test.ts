import { describe, it, expect } from "vitest";
import { contextWindowFor, budgetTokens } from "@/lib/chat/contextBudget";

describe("contextWindowFor", () => {
  it("uses the Ollama contextLength override first", () => {
    expect(contextWindowFor("ollama/llama3", { contextWindow: 4096 }, 16384)).toBe(16384);
  });

  it("falls back to the catalog window for Ollama without an override", () => {
    expect(contextWindowFor("ollama/llama3", { contextWindow: 4096 }, null)).toBe(4096);
  });

  it("ignores contextLength for non-Ollama models", () => {
    expect(contextWindowFor("gpt-4o", { contextWindow: 128000 }, 4096)).toBe(128000);
  });

  it("falls back to 8,192 when nothing is known", () => {
    expect(contextWindowFor("gpt-4o", null)).toBe(8192);
    expect(contextWindowFor("ollama/llama3", null, undefined)).toBe(8192);
  });
});

describe("budgetTokens", () => {
  it("takes a share of the window", () => {
    expect(budgetTokens(8192, 0.25)).toBe(2048);
  });

  it("never exceeds the cap", () => {
    expect(budgetTokens(200000, 0.25, 6000)).toBe(6000);
    expect(budgetTokens(8192, 0.25, 6000)).toBe(2048);
  });
});
