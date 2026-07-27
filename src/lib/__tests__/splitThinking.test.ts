import { describe, it, expect } from "vitest";
import { splitThinking } from "@/lib/utils/splitThinking";

describe("splitThinking", () => {
  it("returns empty thinking and content for empty string", () => {
    const result = splitThinking("");
    expect(result).toEqual({ thinking: "", content: "" });
  });

  it("returns content without think tags as content only", () => {
    const result = splitThinking("Hello world");
    expect(result).toEqual({ thinking: "", content: "Hello world" });
  });

  it("extracts thinking from simple think tags", () => {
    const result = splitThinking("<think>Let me analyze this</think>The answer is 42");
    expect(result.thinking).toBe("Let me analyze this");
    expect(result.content).toBe("The answer is 42");
  });

  it("handles content before, inside, and after think tags", () => {
    const result = splitThinking(
      "Introduction.<think>Deep reasoning here</think>Conclusion.",
    );
    expect(result.thinking).toBe("Deep reasoning here");
    expect(result.content).toBe("Introduction.Conclusion.");
  });

  it("handles unclosed think tags", () => {
    const result = splitThinking("Text <think>still thinking");
    expect(result.thinking).toBe("still thinking");
    expect(result.content).toBe("Text");
  });

  it("removes empty thinking blocks", () => {
    const result = splitThinking("<think></think>Just content");
    expect(result.thinking).toBe("");
    expect(result.content).toBe("Just content");
  });

  it("trims whitespace from thinking content", () => {
    const result = splitThinking("<think>  reasoning  </think>output");
    expect(result.thinking).toBe("reasoning");
    expect(result.content).toBe("output");
  });

  it("handles multiple think blocks", () => {
    const result = splitThinking("<think>First</think>A<think>Second</think>B");
    expect(result.thinking).toBe("First\n\nSecond");
    expect(result.content).toBe("AB");
  });

  it("preserves content text formatting", () => {
    const result = splitThinking("<think>hmm</think>  spaced  ");
    expect(result.content).toBe("spaced");
  });

  it("handles think tags with content containing HTML-like characters", () => {
    const result = splitThinking("<think>a < b && c > d</think>result");
    expect(result.thinking).toBe("a < b && c > d");
    expect(result.content).toBe("result");
  });

  it("handles only think tags with no content", () => {
    const result = splitThinking("<think>reasoning</think>");
    expect(result.thinking).toBe("reasoning");
    expect(result.content).toBe("");
  });

  it("handles newlines inside think tags", () => {
    const result = splitThinking("<think>\nline1\nline2\n</think>content");
    expect(result.thinking).toBe("line1\nline2");
  });
});
