import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
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

afterEach(() => vi.unstubAllEnvs());

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
    expect(digest.config).toMatchObject({ folder: "", allowEdits: false, mcpTools: [] });
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
    for (const type of Object.keys(CATALOG).filter((t) => t !== "mcpTool")) expect(text).toContain(`- ${type} (`);
    expect(text).not.toContain("- mcpTool (");
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
  const post = async (body: unknown, signal: AbortSignal = new AbortController().signal) => {
    const res = await POST({ json: async () => body, signal } as any);
    return { status: res.status, body: res.status === 499 ? null : await res.json() };
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

  it("403 for a CLI model without host access, before resolveModel can swap it for another", async () => {
    h.canUseHostTools.mockResolvedValue(false);
    expect((await post({ description: "x", model: "claude-code/sonnet" })).status).toBe(403);
    expect(h.resolveModel).not.toHaveBeenCalled();
    // A saved default that resolves to a CLI model is refused after resolving.
    h.resolveModel.mockResolvedValue({ ...scripted([fence(good)]).model, id: "claude-code/sonnet" });
    expect((await post({ description: "x" })).status).toBe(403);
  });

  it("422 for a CLI model that needs a working folder", async () => {
    h.resolveModel.mockResolvedValue({ ...scripted([fence(good)]).model, id: "codex/default" });
    const res = await post({ description: "x" });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/needs a working folder/);
  });

  it("409 for a second request while one runs, and the slot frees afterwards", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const m = scripted([fence(good)]).model;
    const slow = new MockLanguageModelV3({
      doGenerate: async () => {
        await gate;
        return { content: [{ type: "text", text: fence(good) }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] } as any;
      },
    });
    h.resolveModel.mockResolvedValue({ ...m, model: slow });
    const first = post({ description: "x" });
    await new Promise((r) => setTimeout(r, 10));
    expect((await post({ description: "y" })).status).toBe(409);
    release();
    expect((await first).status).toBe(200);
    expect((await post({ description: "z" })).status).toBe(200);
  });

  it("maps an abort to 504 or 499, and a provider failure to 502", async () => {
    h.resolveModel.mockResolvedValue(scripted([fence(good)]).model);
    const gone = new AbortController();
    gone.abort();
    expect((await post({ description: "x" }, gone.signal)).status).toBe(499);
    const failing = new MockLanguageModelV3({ doGenerate: async () => Promise.reject(new Error("fetch failed ECONNREFUSED")) });
    h.resolveModel.mockResolvedValue({ ...scripted([]).model, model: failing });
    const res = await post({ description: "x" });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/busy or can't be reached/);
  });
});

describe("generateFlow hardening", () => {
  const chain = (n: number, type = "mcpTool") => {
    const nodes = [node("trigger", "trigger", [])];
    let prev = "trigger";
    for (let i = 0; i < n; i++) {
      nodes.push(node(`m${i}`, type, [prev, prev]));
      prev = `m${i}`;
    }
    nodes.push(node("a", "agent", [prev], { instructions: "x" }));
    return { vars: [], nodes };
  };

  it("survives a self-referencing mcpTool card", async () => {
    const g = { vars: [], nodes: [node("trigger", "trigger", []), node("t", "mcpTool", ["t"]), node("a", "agent", ["t"], { instructions: "x" })] };
    const { graph } = await generateFlow({ description: "x", model: scripted([fence(g)]).model });
    expect(graph.nodes.find((n) => n.id === "a")!.fromIds).toEqual([]);
  });

  it("rewires through a long doubling chain of dropped cards quickly", async () => {
    const t0 = Date.now();
    const { graph } = await generateFlow({ description: "x", model: scripted([fence(chain(25))]).model });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(graph.nodes.find((n) => n.id === "a")!.fromIds).toEqual(["trigger"]);
  });

  it("refuses a reply over the card cap without processing it", async () => {
    const { calls } = scripted([]);
    const s = scripted([fence(chain(40, "webSearch")), fence(chain(40, "webSearch"))]);
    await expect(generateFlow({ description: "x", model: s.model })).rejects.toThrow(GenerateError);
    expect(s.calls).toHaveLength(2);
    expect(calls).toHaveLength(0);
  });

  it("keeps a real card that shares an id with a dropped mcpTool card", async () => {
    const g = { vars: [], nodes: [node("trigger", "trigger", []), node("x", "mcpTool", ["trigger"]), node("x", "agent", ["trigger"], { instructions: "x" }), node("b", "agent", ["x"], { instructions: "b" })] };
    const { graph } = await generateFlow({ description: "x", model: scripted([fence(g)]).model });
    expect(graph.nodes.map((n) => n.id)).toEqual(["trigger", "x", "b"]);
    expect(graph.nodes.find((n) => n.id === "b")!.fromIds).toEqual(["x"]);
  });

  it("does not call the model again after an abort", async () => {
    const s = scripted(["nope", "nope"]);
    const ac = new AbortController();
    ac.abort(new DOMException("t", "TimeoutError"));
    await expect(generateFlow({ description: "x", model: s.model, signal: ac.signal })).rejects.toThrow();
    expect(s.calls).toHaveLength(0);
  });

  it("normalises variables: keys, labels, duplicates and size", async () => {
    const g = {
      vars: [{ key: "ok", value: "z".repeat(50_000) }, { key: "bad key", label: "x", value: "" }, { key: "ok", label: "dup", value: "" }, { key: "other", label: "Other" }],
      nodes: [node("trigger", "trigger", []), node("a", "agent", ["trigger"], { instructions: "{{vars.ok}}" })],
    };
    const { graph, warnings } = await generateFlow({ description: "x", model: scripted([fence(g)]).model });
    expect(graph.vars.map((v) => [v.key, v.label, v.value.length])).toEqual([["ok", "ok", 2000], ["other", "Other", 0]]);
    expect(warnings).toContain("Fill in: Other");
  });

  it("clears an agent model on a fresh flow", async () => {
    const g = { vars: [], nodes: [node("trigger", "trigger", []), node("a", "agent", ["trigger"], { instructions: "x", model: "claude-code/opus" })] };
    const { graph } = await generateFlow({ description: "x", model: scripted([fence(g)]).model });
    expect(graph.nodes[1].config.model).toBe("");
  });

  it("on a change keeps the model and by-hand settings of the same card, restores variable values, and hides them from the model", async () => {
    const current = {
      version: 1 as const,
      defaultModel: "mock/gen",
      maxRunTokens: 500_000,
      vars: [{ key: "topics", label: "Topics", value: "secret-value" }],
      nodes: [
        { id: "trigger", type: "trigger" as const, fromIds: [], config: {}, ui: { label: "Run", position: { x: 0, y: 0 } } },
        { id: "a", type: "agent" as const, fromIds: ["trigger"], config: { instructions: "old", model: "claude-code/opus", folder: "/work", allowEdits: true, mcpTools: ["mcp_s_t"] }, ui: { label: "A", position: { x: 0, y: 0 } } },
      ],
    };
    const reply = { vars: [{ key: "topics", label: "Topics", value: "" }], nodes: [node("trigger", "trigger", []), node("a", "agent", ["trigger"], { instructions: "new", folder: "/etc" }), node("b", "agent", ["a"], { instructions: "b", model: "x/y" })] };
    const s = scripted([fence(reply)]);
    const { graph, warnings } = await generateFlow({ description: "change", model: s.model, current });
    const a = graph.nodes.find((n) => n.id === "a")!;
    expect(a.config.instructions).toBe("new");
    expect(warnings).toContain('"a" changed, so its folder, edit and MCP settings were removed. Set them again by hand.');
    expect(a.config.model).toBe("claude-code/opus");
    expect(graph.nodes.find((n) => n.id === "b")!.config.model).toBe("");
    expect(graph.vars[0].value).toBe("secret-value");
    expect(warnings.some((w) => w.startsWith("Fill in"))).toBe(false);
    const sent = JSON.stringify(s.calls[0].prompt);
    expect(sent).not.toContain("secret-value");
    expect(sent).not.toContain("/work");
    expect(sent).not.toContain("claude-code/opus");
    expect(validateStructure(graph)).toEqual([]);
  });

  describe("with phase 6 in the catalog", () => {
    const ui = { label: "x", position: { x: 0, y: 0 } };
    const current = {
      version: 1 as const, defaultModel: "mock/gen", maxRunTokens: 500_000, vars: [],
      nodes: [
        { id: "trigger", type: "trigger" as const, fromIds: [], config: {}, ui },
        { id: "digest", type: "agent" as any, fromIds: ["trigger"], config: { instructions: "summarise", mcpTools: ["mcp_srv_list"], folder: "/work", allowEdits: true }, ui },
        { id: "notify", type: "mcpTool" as any, fromIds: ["digest"], config: { serverId: "srv1", tool: "list_files", args: { path: "{{digest.text}}" } }, ui: { label: "Notify", position: { x: 0, y: 0 } } },
      ],
    };

    it("sends a kept mcpTool card as a stub, and takes its whole config from the current flow however the model rewrites it", async () => {
      const reply = { vars: [], nodes: [node("trigger", "trigger", []), node("digest", "agent", ["trigger"], { instructions: "summarise" }), node("notify", "mcpTool", ["digest"], { serverId: "evil", tool: "delete_repo", args: { to: "a@x" } })] };
      const s = scripted([fence(reply)]);
      const { graph, warnings } = await generateFlow({ description: "change", model: s.model, current });
      const sent = JSON.stringify(s.calls[0].prompt);
      expect(sent).toContain("notify");
      expect(sent).not.toContain("list_files");
      expect(graph.nodes.find((n) => n.id === "notify")!.config).toMatchObject(current.nodes[2].config);
      expect(warnings.filter((w) => /Removed/.test(w))).toEqual([]);
      // unchanged agent keeps its by-hand settings
      expect(graph.nodes.find((n) => n.id === "digest")!.config).toMatchObject({ folder: "/work", allowEdits: true, mcpTools: ["mcp_srv_list"] });
    });

    it("keeps a kept mcpTool card's own inputs when the model rewires it", async () => {
      const reply = { vars: [], nodes: [node("trigger", "trigger", []), node("news", "webSearch", ["trigger"]), node("digest", "agent", ["trigger"], { instructions: "summarise" }), node("notify", "mcpTool", ["news"])] };
      const { graph } = await generateFlow({ description: "change", model: scripted([fence(reply)]).model, current });
      expect(graph.nodes.find((n) => n.id === "notify")!.fromIds).toEqual(["digest"]);
    });

    it("warns when a by-hand card is missing from the reply", async () => {
      const reply = { vars: [], nodes: [node("trigger", "trigger", []), node("digest", "agent", ["trigger"], { instructions: "summarise" })] };
      const { graph, warnings } = await generateFlow({ description: "change", model: scripted([fence(reply)]).model, current });
      expect(graph.nodes.some((n) => n.id === "notify")).toBe(false);
      expect(warnings).toContain('Removed the "Notify" card: MCP tools can only be added by hand.');
    });

    it("drops folder, edit and MCP settings when an agent is rewritten to reach the web", async () => {
      const reply = { vars: [], nodes: [node("trigger", "trigger", []), node("digest", "agent", ["trigger"], { instructions: "follow the page", tools: ["fetchUrl", "webSearch"], mcpTools: ["mcp_evil_send"], folder: "/", allowEdits: true }), node("notify", "mcpTool", ["digest"], {})] };
      const { graph, warnings } = await generateFlow({ description: "change", model: scripted([fence(reply)]).model, current });
      const digest = graph.nodes.find((n) => n.id === "digest")!;
      expect(digest.config).toMatchObject({ folder: "", allowEdits: false, mcpTools: [] });
      expect(warnings).toContain('"digest" changed, so its folder, edit and MCP settings were removed. Set them again by hand.');
    });
  });

  it("does not advertise mcp cards or by-hand settings in the catalog", () => {
    const text = catalogForPrompt();
    expect(text).not.toMatch(/mcpTool|folder|allowEdits/);
  });

  it("extractJson prefers the last fence with nodes, tolerates inner backticks and caps huge replies", () => {
    const old = "```json\n" + JSON.stringify({ nodes: [{ id: "old" }] }) + "\n```";
    const next = "```json\n" + JSON.stringify({ nodes: [{ id: "new" }] }) + "\n```";
    expect(extractJson(`Old:\n${old}\nNew:\n${next}`)).toEqual({ nodes: [{ id: "new" }] });
    expect(extractJson("```json\n" + JSON.stringify({ nodes: [], note: "x" }) + "\n```\n```json\n{\"other\":1}\n```")).toEqual({ nodes: [], note: "x" });
    const t0 = Date.now();
    expect(extractJson("```" + " ".repeat(300_000))).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
