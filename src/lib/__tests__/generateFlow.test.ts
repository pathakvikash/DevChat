import { describe, it, expect, vi, beforeEach } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import type { ModelConfig } from "@/lib/models";

const h = vi.hoisted(() => ({
  requireUserId: vi.fn(),
  resolveModel: vi.fn(),
  canUseHostTools: vi.fn(),
  findFirst: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireUserId: h.requireUserId, UnauthorizedError: class extends Error {} }));
vi.mock("@/lib/llm", () => ({ resolveModel: h.resolveModel }));
vi.mock("@/lib/hostAccess", () => ({ canUseHostTools: h.canUseHostTools, HOST_TOOLS_REFUSED: "owner only" }));
vi.mock("@/lib/settings", () => ({ getSettingsKey: vi.fn(async () => "") }));
vi.mock("@/lib/db", () => ({ prisma: { workflow: { findFirst: h.findFirst } } }));

import { buildSystemPrompt, catalogForPrompt, extractJson, generateFlow, GenerateError, layoutGraph } from "@/lib/workflows/generate";
import { validateStructure } from "@/lib/workflows/graph";
import { CATALOG } from "@/lib/workflows/catalog";
const { POST } = await import("@/app/api/workflows/generate/route");

const usage = {
  inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

/** A model that answers each call from `replies` in turn, and records the prompts. */
function scripted(replies: string[], contextWindow = 32_000) {
  let n = 0;
  const calls: { system?: string; prompt: any[] }[] = [];
  const mock = new MockLanguageModelV3({
    provider: "mock",
    modelId: "mock/gen",
    doGenerate: async (o: any) => {
      calls.push({ system: o.prompt.find((m: any) => m.role === "system")?.content, prompt: o.prompt });
      return { content: [{ type: "text", text: replies[Math.min(n++, replies.length - 1)] }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] } as any;
    },
  });
  const model = { id: "mock/gen", name: "gen", provider: "Mock", model: mock, contextWindow, supportsTools: false } as unknown as ModelConfig;
  return { model, calls };
}

const fence = (v: unknown) => `Here you go\n\`\`\`json\n${JSON.stringify(v)}\n\`\`\``;
const node = (id: string, type: string, fromIds: string[], config: Record<string, unknown> = {}) => ({ id, type, fromIds, config, label: id });
const good = {
  vars: [{ key: "topics", label: "Your topics", value: "" }],
  nodes: [
    node("trigger", "trigger", []),
    node("news", "webSearch", ["trigger"], { queries: "{{vars.topics}}", junk: 1 }),
    node("digest", "agent", ["news"], { instructions: "Summarise", input: "{{news.items}}" }),
    node("post", "chatMessage", ["digest"], { message: "{{digest.text}}" }),
  ],
};

describe("generateFlow", () => {
  it("extracts the JSON from a fence or from loose braces", () => {
    expect(extractJson('text ```json\n{"a":1}\n``` more')).toEqual({ a: 1 });
    expect(extractJson('sure: {"a":2} done')).toEqual({ a: 2 });
    expect(extractJson("no json")).toBeUndefined();
  });

  it("fills defaults, drops unknown keys, lays cards out and lists variables to fill in", async () => {
    const { model } = scripted([fence(good)]);
    const { graph, warnings } = await generateFlow({ description: "news", model });
    const search = graph.nodes.find((n) => n.id === "news")!;
    expect(search.config).toMatchObject({ provider: "", perItem: false, maxItems: 25 });
    expect(search.config).not.toHaveProperty("junk");
    expect(graph.nodes.map((n) => n.ui.position)).toEqual([0, 1, 2, 3].map((l) => ({ x: l * 280, y: 0 })));
    expect(warnings).toContain("Fill in: Your topics");
    expect(validateStructure(graph)).toEqual([]);
    expect(graph.defaultModel).toBe("mock/gen");
  });

  it("makes one repair call, listing the errors, when a card type is unknown", async () => {
    const bad = { ...good, nodes: [...good.nodes.slice(0, 3), node("x", "teleport", ["digest"])] };
    const { model, calls } = scripted([fence(bad), fence(good)]);
    const { graph } = await generateFlow({ description: "news", model });
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[1].prompt)).toContain("unknown type");
    expect(JSON.stringify(calls[1].prompt)).toContain("Reply with the corrected JSON only");
    expect(graph.nodes).toHaveLength(4);
  });

  it("fails with a plain message when the repair is still invalid", async () => {
    const { model, calls } = scripted(["not json", "still not json"]);
    await expect(generateFlow({ description: "x", model })).rejects.toThrow(GenerateError);
    expect(calls).toHaveLength(2);
  });

  it("removes MCP tools, folder, allowEdits and mcpTool cards, with warnings", async () => {
    const risky = {
      vars: [],
      nodes: [
        node("trigger", "trigger", []),
        node("tool", "mcpTool", ["trigger"], { server: "s" }),
        node("digest", "agent", ["tool"], { instructions: "Do", tools: ["calculator", "mcp__srv__run"], folder: "/etc", allowEdits: true }),
        node("post", "chatMessage", ["digest"], { message: "{{digest.text}}" }),
      ],
    };
    const { model } = scripted([fence(risky)]);
    const { graph, warnings } = await generateFlow({ description: "x", model });
    const digest = graph.nodes.find((n) => n.id === "digest")!;
    expect(digest.config.tools).toEqual(["calculator"]);
    expect(digest.config).not.toHaveProperty("folder");
    expect(digest.config).not.toHaveProperty("allowEdits");
    expect(graph.nodes.some((n) => n.type === ("mcpTool" as string))).toBe(false);
    expect(digest.fromIds).toEqual(["trigger"]);
    expect(warnings.filter((w) => /Removed/.test(w))).toHaveLength(4);
    expect(validateStructure(graph)).toEqual([]);
  });

  it("refuses a flow where a chat-reading card feeds a web card (chatLeaks)", async () => {
    const leak = {
      vars: [],
      nodes: [node("trigger", "trigger", []), node("read", "agent", ["trigger"], { instructions: "r", tools: ["searchChats"] }), node("web", "webSearch", ["read"], { queries: "q" })],
    };
    const { model, calls } = scripted([fence(leak)]);
    await expect(generateFlow({ description: "x", model })).rejects.toThrow(GenerateError);
    expect(calls).toHaveLength(2);
  });

  it("lays out by level and row", () => {
    const g = layoutGraph({
      version: 1,
      defaultModel: "",
      maxRunTokens: 1000,
      vars: [],
      nodes: [node("trigger", "trigger", []), node("a", "webSearch", ["trigger"]), node("b", "webSearch", ["trigger"]), node("c", "agent", ["a", "b"])].map((n) => ({ ...n, type: n.type as any, ui: { label: n.id, position: { x: 9, y: 9 } } })),
    });
    expect(g.nodes.map((n) => [n.id, n.ui.position.x, n.ui.position.y])).toEqual([["trigger", 0, 0], ["a", 280, 0], ["b", 280, 160], ["c", 560, 0]]);
  });

  it("builds the catalog text from the registry and leaves examples out for small windows", () => {
    const text = catalogForPrompt();
    for (const type of Object.keys(CATALOG)) expect(text).toContain(`- ${type} (`);
    expect(buildSystemPrompt(8192)).not.toContain("Example workflows");
    expect(buildSystemPrompt(32_000)).toContain("Example workflows");
  });
});

describe("mock/flowgen", () => {
  it("returns the News graph, and recovers from invalid JSON through the repair call", async () => {
    vi.stubEnv("SANITY_TEST_AUTH", "1");
    vi.stubEnv("DATABASE_URL", "file:./prisma/sanity.db");
    const { mockModelConfig } = await import("@/lib/mockModels");
    const model = mockModelConfig("mock/flowgen")!;
    const plain = await generateFlow({ description: "news", model });
    expect(plain.graph.nodes.map((n) => n.id)).toEqual(["trigger", "news", "digest", "post"]);
    const broken = await generateFlow({ description: "a broken one", model });
    expect(broken.graph.nodes).toHaveLength(4);
    vi.unstubAllEnvs();
  });
});

describe("POST /api/workflows/generate", () => {
  const post = async (body: unknown) => {
    const res = await POST({ json: async () => body } as any);
    return { status: res.status, body: await res.json() };
  };
  beforeEach(() => {
    vi.clearAllMocks();
    h.requireUserId.mockResolvedValue("u1");
    h.canUseHostTools.mockResolvedValue(true);
  });

  it("returns a proposed graph and saves nothing", async () => {
    h.resolveModel.mockResolvedValue(scripted([fence(good)]).model);
    const res = await post({ description: "news digest" });
    expect(res.status).toBe(200);
    expect(res.body.graph.nodes).toHaveLength(4);
    expect(res.body.warnings).toContain("Fill in: Your topics");
  });

  it("422 when the model cannot produce a flow, 400 for an empty description", async () => {
    h.resolveModel.mockResolvedValue(scripted(["nope"]).model);
    expect((await post({ description: "x" })).status).toBe(422);
    expect((await post({ description: "  " })).status).toBe(400);
  });

  it("404 for another user's workflow", async () => {
    h.findFirst.mockResolvedValue(null);
    expect((await post({ description: "x", workflowId: "w9" })).status).toBe(404);
    expect(h.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "w9", userId: "u1" } }));
  });

  it("403 for a CLI model without host access", async () => {
    h.resolveModel.mockResolvedValue({ ...scripted([fence(good)]).model, id: "claude-code/sonnet" });
    h.canUseHostTools.mockResolvedValue(false);
    expect((await post({ description: "x" })).status).toBe(403);
  });
});
