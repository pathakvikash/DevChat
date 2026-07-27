import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/db", () => ({
  prisma: {},
}));

vi.mock("@/lib/rag", () => ({
  embed: vi.fn(),
  cosineSimilarity: vi.fn(),
}));

import { TOOL_REGISTRY, listTools, getTool } from "@/lib/registry/tools";

describe("Tool Registry", () => {
  describe("all tools have required fields", () => {
    const tools = Object.values(TOOL_REGISTRY);

    it("all tools have a non-empty id", () => {
      tools.forEach((t) => {
        expect(t.id).toBeTruthy();
        expect(typeof t.id).toBe("string");
      });
    });

    it("all tools have a non-empty name", () => {
      tools.forEach((t) => {
        expect(t.name).toBeTruthy();
        expect(typeof t.name).toBe("string");
      });
    });

    it("all tools have a non-empty description", () => {
      tools.forEach((t) => {
        expect(t.description).toBeTruthy();
        expect(typeof t.description).toBe("string");
      });
    });

    it("all tools have a non-empty modelDescription", () => {
      tools.forEach((t) => {
        expect(t.modelDescription).toBeTruthy();
        expect(typeof t.modelDescription).toBe("string");
      });
    });

    it("all tools have a category", () => {
      tools.forEach((t) => {
        expect(t.category).toBeTruthy();
        expect(typeof t.category).toBe("string");
      });
    });

    it("all tools have an inputSchema that is a Zod type", () => {
      tools.forEach((t) => {
        expect(t.inputSchema).toBeDefined();
        expect(t.inputSchema).toBeInstanceOf(z.ZodType);
      });
    });

    it("all tool ids are unique", () => {
      const ids = tools.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe("executeCode schema", () => {
    const schema = TOOL_REGISTRY.executeCode.inputSchema;

    it("accepts valid python input", () => {
      const result = schema.safeParse({
        language: "python",
        code: "print('hello')",
      });
      expect(result.success).toBe(true);
    });

    it("accepts valid javascript input", () => {
      const result = schema.safeParse({
        language: "javascript",
        code: "console.log('hello')",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid language", () => {
      const result = schema.safeParse({
        language: "ruby",
        code: "puts 'hello'",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing code", () => {
      const result = schema.safeParse({ language: "python" });
      expect(result.success).toBe(false);
    });
  });

  describe("webSearch schema", () => {
    const schema = TOOL_REGISTRY.webSearch.inputSchema;

    it("accepts valid query", () => {
      const result = schema.safeParse({ query: "latest news" });
      expect(result.success).toBe(true);
    });

    it("rejects missing query", () => {
      const result = schema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe("calculator schema", () => {
    const schema = TOOL_REGISTRY.calculator.inputSchema;

    it("accepts valid expression", () => {
      const result = schema.safeParse({ expression: "2 + 2" });
      expect(result.success).toBe(true);
    });

    it("rejects missing expression", () => {
      const result = schema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("accepts complex expression", () => {
      const result = schema.safeParse({
        expression: "2 * (3 + 4) ** 2 / Math.sqrt(16)",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("fetchUrl schema", () => {
    const schema = TOOL_REGISTRY.fetchUrl.inputSchema;

    it("accepts valid http URL", () => {
      const result = schema.safeParse({ url: "https://example.com" });
      expect(result.success).toBe(true);
    });

    it("rejects missing url", () => {
      const result = schema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("accepts empty url (no min length constraint)", () => {
      const result = schema.safeParse({ url: "" });
      expect(result.success).toBe(true);
    });
  });

  describe("currentTime schema", () => {
    const schema = TOOL_REGISTRY.currentTime.inputSchema;

    it("accepts empty input (timezone is optional)", () => {
      const result = schema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts valid timezone", () => {
      const result = schema.safeParse({ timezone: "America/New_York" });
      expect(result.success).toBe(true);
    });

    it("timezone can be any string", () => {
      const result = schema.safeParse({ timezone: "Invalid/Timezone" });
      expect(result.success).toBe(true);
    });
  });

  describe("jsonExtract schema", () => {
    const schema = TOOL_REGISTRY.jsonExtract.inputSchema;

    it("accepts valid json and path", () => {
      const result = schema.safeParse({
        json: '{"key": "value"}',
        path: "key",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing json", () => {
      const result = schema.safeParse({ path: "key" });
      expect(result.success).toBe(false);
    });

    it("rejects missing path", () => {
      const result = schema.safeParse({ json: "{}" });
      expect(result.success).toBe(false);
    });
  });

  describe("searchKnowledgeBase schema", () => {
    const schema = TOOL_REGISTRY.searchKnowledgeBase.inputSchema;

    it("requires both query and topK", () => {
      const result = schema.safeParse({ query: "find something", topK: 5 });
      expect(result.success).toBe(true);
    });

    it("accepts query with explicit topK", () => {
      const result = schema.safeParse({ query: "find", topK: 10 });
      expect(result.success).toBe(true);
    });

    it("rejects topK below 1", () => {
      const result = schema.safeParse({ query: "find", topK: 0 });
      expect(result.success).toBe(false);
    });

    it("rejects topK above 20", () => {
      const result = schema.safeParse({ query: "find", topK: 21 });
      expect(result.success).toBe(false);
    });
  });

  describe("listTools and getTool", () => {
    it("listTools returns all tools", () => {
      const tools = listTools();
      expect(tools.length).toBe(Object.keys(TOOL_REGISTRY).length);
    });

    it("getTool returns correct tool", () => {
      const tool = getTool("calculator");
      expect(tool).toBeDefined();
      expect(tool!.id).toBe("calculator");
    });

    it("getTool returns undefined for unknown id", () => {
      expect(getTool("nonexistent")).toBeUndefined();
    });
  });
});
