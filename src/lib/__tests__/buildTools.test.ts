import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildTools, resolveActiveToolIds } from "@/lib/chat/buildTools";
import { z } from "zod";

vi.mock("@/lib/db", () => ({
  prisma: {
    conversation: { findUnique: vi.fn() },
    document: { findMany: vi.fn() },
    memory: {
      upsert: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
    },
    mcpServer: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("@/lib/search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/search")>()),
  webSearch: vi.fn(),
}));

vi.mock("@/lib/rag", () => ({
  embed: vi.fn(),
  cosineSimilarity: vi.fn(),
}));

vi.mock("@/lib/mcp/client", () => ({
  listServerTools: vi.fn().mockResolvedValue([]),
  callServerTool: vi.fn(),
}));

describe("resolveActiveToolIds", () => {
  it("includes built-in tools by default", () => {
    const result = resolveActiveToolIds([], []);
    expect(result.has("executeCode")).toBe(true);
    expect(result.has("webSearch")).toBe(true);
    expect(result.has("rememberFact")).toBe(true);
    expect(result.has("forgetFact")).toBe(true);
  });

  it("adds explicit tool ids", () => {
    const result = resolveActiveToolIds(["fetchUrl", "calculator"], []);
    expect(result.has("fetchUrl")).toBe(true);
    expect(result.has("calculator")).toBe(true);
  });

  it("adds skill tool ids", () => {
    const result = resolveActiveToolIds([], ["web-researcher"]);
    expect(result.has("webSearch")).toBe(true);
  });
});

describe("buildTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an object with tool keys", async () => {
    const tools = await buildTools({
      activeToolIds: new Set(["executeCode", "webSearch"]),
      searchProvider: "duckduckgo",
      userId: "test-user",
    });
    expect(tools).toHaveProperty("webSearch");
    expect(tools).not.toHaveProperty("fetchUrl");
  });

  it("includes rememberFact tool when active", async () => {
    const tools = await buildTools({
      activeToolIds: new Set(["rememberFact"]),
      searchProvider: "duckduckgo",
      userId: "test-user",
    });
    expect(tools).toHaveProperty("rememberFact");
  });

  it("rememberFact tool has execute function", async () => {
    const tools = await buildTools({
      activeToolIds: new Set(["rememberFact"]),
      searchProvider: "duckduckgo",
      userId: "test-user",
    });
    expect(typeof tools.rememberFact.execute).toBe("function");
  });

  it("rememberFact input schema requires key and value", async () => {
    const tools = await buildTools({
      activeToolIds: new Set(["rememberFact"]),
      searchProvider: "duckduckgo",
      userId: "test-user",
    });
    const schema = (tools.rememberFact as any).inputSchema as z.ZodTypeAny;
    expect(schema).toBeDefined();
    const parsed = (schema as z.ZodObject<any>).safeParse({ key: "name", value: "Alice" });
    expect(parsed.success).toBe(true);
  });

  it("rememberFact input schema rejects missing key", async () => {
    const tools = await buildTools({
      activeToolIds: new Set(["rememberFact"]),
      searchProvider: "duckduckgo",
      userId: "test-user",
    });
    const schema = (tools.rememberFact as any).inputSchema as z.ZodObject<any>;
    const parsed = schema.safeParse({ value: "Alice" });
    expect(parsed.success).toBe(false);
  });

  it("rememberFact input schema rejects missing value", async () => {
    const tools = await buildTools({
      activeToolIds: new Set(["rememberFact"]),
      searchProvider: "duckduckgo",
      userId: "test-user",
    });
    const schema = (tools.rememberFact as any).inputSchema as z.ZodObject<any>;
    const parsed = schema.safeParse({ key: "name" });
    expect(parsed.success).toBe(false);
  });

  it("includes forgetFact tool when active", async () => {
    const tools = await buildTools({
      activeToolIds: new Set(["forgetFact"]),
      searchProvider: "duckduckgo",
      userId: "test-user",
    });
    expect(tools).toHaveProperty("forgetFact");
    expect(typeof tools.forgetFact.execute).toBe("function");
  });

  it("forgetFact input schema requires key", async () => {
    const tools = await buildTools({
      activeToolIds: new Set(["forgetFact"]),
      searchProvider: "duckduckgo",
      userId: "test-user",
    });
    const schema = (tools.forgetFact as any).inputSchema as z.ZodObject<any>;
    const parsed = schema.safeParse({ key: "name" });
    expect(parsed.success).toBe(true);
  });

  it("forgetFact rejects empty key", async () => {
    const tools = await buildTools({
      activeToolIds: new Set(["forgetFact"]),
      searchProvider: "duckduckgo",
      userId: "test-user",
    });
    const schema = (tools.forgetFact as any).inputSchema as z.ZodObject<any>;
    const parsed = schema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  it("webSearch tool produces correct execute output", async () => {
    const { webSearch } = await import("@/lib/search");
    (webSearch as any).mockResolvedValue({
      results: [
        { title: "Result 1", url: "https://example.com/1", snippet: "Snippet 1" },
      ],
      usedProvider: "duckduckgo",
    });

    const tools = await buildTools({
      activeToolIds: new Set(["webSearch"]),
      searchProvider: "duckduckgo",
      userId: "test-user",
    });

    const result = await tools.webSearch.execute!({ query: "test query" }, {} as any);
    expect(result).toContain("Result 1");
    expect(result).toContain("https://example.com/1");
    expect(result).toContain("Snippet 1");
    expect(result).toContain("duckduckgo");
  });

  it("webSearch handles empty results", async () => {
    const { webSearch } = await import("@/lib/search");
    (webSearch as any).mockResolvedValue({
      results: [],
      usedProvider: "duckduckgo",
    });

    const tools = await buildTools({
      activeToolIds: new Set(["webSearch"]),
      searchProvider: "duckduckgo",
      userId: "test-user",
    });

    const result = await tools.webSearch.execute!({ query: "nothing" }, {} as any);
    expect(result).toContain("No results");
  });

  it("includes server-side tools with execute function", async () => {
    const tools = await buildTools({
      activeToolIds: new Set(["fetchUrl", "calculator"]),
      searchProvider: "duckduckgo",
      userId: "test-user",
    });
    expect(tools).toHaveProperty("fetchUrl");
    expect(tools).toHaveProperty("calculator");
    expect(typeof tools.fetchUrl.execute).toBe("function");
  });
});

describe("buildTools mode gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const ALL = new Set([
    "executeCode",
    "webSearch",
    "calculator",
    "createArtifact",
    "updateArtifact",
    "createTodo",
    "updateTodo",
    "createTodos",
    "rememberFact",
    "forgetFact",
  ]);

  it("chat mode withholds every mutating tool", async () => {
    const tools = await buildTools({
      activeToolIds: ALL,
      searchProvider: "duckduckgo",
      userId: "test-user",
      mode: "chat",
    });
    for (const id of [
      "createArtifact",
      "updateArtifact",
      "createTodo",
      "updateTodo",
      "createTodos",
      "rememberFact",
      "forgetFact",
    ]) {
      expect(tools).not.toHaveProperty(id);
    }
  });

  it("chat mode keeps read-only tools, including executeCode", async () => {
    const tools = await buildTools({
      activeToolIds: ALL,
      searchProvider: "duckduckgo",
      userId: "test-user",
      mode: "chat",
    });
    expect(tools).toHaveProperty("executeCode");
    expect(tools).toHaveProperty("webSearch");
    expect(tools).toHaveProperty("calculator");
  });

  it("agent mode exposes the mutating tools", async () => {
    const tools = await buildTools({
      activeToolIds: ALL,
      searchProvider: "duckduckgo",
      userId: "test-user",
      mode: "agent",
    });
    expect(tools).toHaveProperty("createArtifact");
    expect(tools).toHaveProperty("createTodos");
    expect(tools).toHaveProperty("rememberFact");
    expect(tools).toHaveProperty("forgetFact");
  });

  it("defaults to agent so server-side callers keep full capability", async () => {
    const tools = await buildTools({
      activeToolIds: ALL,
      searchProvider: "duckduckgo",
      userId: "test-user",
    });
    expect(tools).toHaveProperty("createArtifact");
  });

  it("chat mode never queries MCP servers", async () => {
    const { prisma } = await import("@/lib/db");
    await buildTools({
      activeToolIds: ALL,
      searchProvider: "duckduckgo",
      userId: "test-user",
      mode: "chat",
    });
    expect((prisma as any).mcpServer.findMany).not.toHaveBeenCalled();
  });
});
