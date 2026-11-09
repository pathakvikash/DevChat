import { describe, it, expect, vi, beforeEach } from "vitest";
import { tool } from "ai";
import { z } from "zod";

const findFirst = vi.fn();
const findMany = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { mcpServer: { findFirst: (a: unknown) => findFirst(a), findMany: (a: unknown) => findMany(a) } } }));
const listServerTools = vi.fn();
const callServerTool = vi.fn();
vi.mock("@/lib/mcp/client", () => ({ listServerTools: (...a: unknown[]) => listServerTools(...a), callServerTool: (...a: unknown[]) => callServerTool(...a) }));
const canUseHostTools = vi.fn(async () => true);
vi.mock("@/lib/hostAccess", () => ({ canUseHostTools: () => canUseHostTools(), HOST_TOOLS_REFUSED: "This is only available to the server's owner." }));
const isRunnableCwd = vi.fn(async (_f: string) => true);
vi.mock("@/lib/claude/sessions", () => ({ isRunnableCwd: (f: string) => isRunnableCwd(f) }));
vi.mock("@/lib/models", () => ({ getModel: vi.fn(), initializeOllamaModels: vi.fn(async () => {}) }));
vi.mock("@/lib/apiKeys", () => ({ resolveProviderCreds: vi.fn(async () => ({})) }));
vi.mock("@/lib/settings", () => ({ getSettingsKey: vi.fn(async () => "") }));
vi.mock("@/lib/observability", () => ({ recordTrace: vi.fn(async () => {}) }));

import { mcpToolCard } from "@/lib/workflows/cards/mcpTool";
import { cliFolderAccess, filterTools, resolveMcpTools } from "@/lib/workflows/cards/agent";
import { AGENT_TOOL_IDS, hasToolConflict, parseConfig, reachesWeb } from "@/lib/workflows/catalog";
import { chatLeaks, checkGraph, emptyGraph, validateStructure, type FlowNode, type WorkflowGraph } from "@/lib/workflows/graph";
import type { CardCtx } from "@/lib/workflows/cards";

const cardCtx = (config: Record<string, unknown>): CardCtx => ({
  userId: "u1",
  workflowId: "wf",
  node: { id: "m", type: "mcpTool", fromIds: ["trigger"], config, ui: { label: "M", position: { x: 0, y: 0 } } },
  config: parseConfig("mcpTool", config).config,
  tctx: { nodes: {}, vars: {}, item: { url: "https://a.test" }, index: 1, run: { id: "r", date: "2026-11-09", startedAt: "" }, workflow: { name: "WF" } },
  defaultModel: "",
  signal: new AbortController().signal,
});
const cfg = { serverId: "s1", tool: "create_issue", args: { title: "Hi {{item.url}}", n: "{{index}}" } };

beforeEach(() => {
  for (const m of [findFirst, findMany, listServerTools, callServerTool, isRunnableCwd]) m.mockReset();
  canUseHostTools.mockResolvedValue(true);
  isRunnableCwd.mockResolvedValue(true);
  findFirst.mockResolvedValue({ id: "s1", name: "gh" });
  listServerTools.mockResolvedValue([{ name: "create_issue" }]);
});

describe("mcpTool card", () => {
  it("calls the tool with rendered args and keeps parsed JSON as data", async () => {
    callServerTool.mockResolvedValue({ content: [{ type: "text", text: '{"id":7}' }] });
    const r = await mcpToolCard.run(cardCtx(cfg));
    expect(callServerTool).toHaveBeenCalledWith("s1", "create_issue", { title: "Hi https://a.test", n: 1 });
    expect(r.output).toEqual({ text: '{"id":7}', data: { id: 7 } });
  });

  it("looks the server up by id, owner and enabled, so another user's or a disabled one is refused", async () => {
    findFirst.mockResolvedValue(null);
    await expect(mcpToolCard.run(cardCtx(cfg))).rejects.toThrow(/isn't available/);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "s1", userId: "u1", enabled: true } }));
    expect(callServerTool).not.toHaveBeenCalled();
  });

  it("fails when the tool reports isError", async () => {
    callServerTool.mockResolvedValue({ content: [{ type: "text", text: "boom" }], isError: true });
    await expect(mcpToolCard.run(cardCtx(cfg))).rejects.toThrow("boom");
  });

  it("refuses a tool the server does not list, and a non-owner", async () => {
    await expect(mcpToolCard.run(cardCtx({ ...cfg, tool: "drop_everything" }))).rejects.toThrow(/no tool called/);
    canUseHostTools.mockResolvedValue(false);
    await expect(mcpToolCard.run(cardCtx(cfg))).rejects.toThrow(/owner/);
    expect(callServerTool).not.toHaveBeenCalled();
  });
});

describe("agent MCP tools", () => {
  it("keeps the built-in enum closed: an mcp id in `tools` is a config error, in `mcpTools` it is accepted", () => {
    expect(AGENT_TOOL_IDS.some((id) => id.startsWith("mcp_"))).toBe(false);
    expect(parseConfig("agent", { tools: ["mcp_gh_create_issue"] }).errors.length).toBeGreaterThan(0);
    expect(parseConfig("agent", { mcpTools: ["mcp_gh_create_issue"] }).errors).toEqual([]);
    expect(parseConfig("agent", { mcpTools: ["rm_rf"] }).errors.length).toBeGreaterThan(0);
  });

  it("filterTools keeps a validated mcp id, and nothing else outside the offer list", () => {
    const t = tool({ description: "x", inputSchema: z.object({}), execute: async () => "" });
    const built = { webSearch: t, mcp_gh_create_issue: t, mcp_other_tool: t, executeCode: t };
    expect(Object.keys(filterTools(built, ["webSearch", "executeCode"], ["mcp_gh_create_issue"])).sort()).toEqual(["mcp_gh_create_issue", "webSearch"]);
    expect(Object.keys(filterTools(built, ["mcp_other_tool"]))).toEqual([]);
  });

  it("resolveMcpTools passes ids the user's enabled servers offer and fails the rest", async () => {
    findMany.mockResolvedValue([{ id: "s1", name: "gh" }]);
    expect(await resolveMcpTools("u1", ["mcp_gh_create_issue"])).toEqual(["mcp_gh_create_issue"]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { enabled: true, userId: "u1" } }));
    await expect(resolveMcpTools("u1", ["mcp_gh_delete_repo"])).rejects.toThrow(/isn't available/);
    await expect(resolveMcpTools("u1", ["mcp_evil_tool"])).rejects.toThrow(/isn't available/);
    canUseHostTools.mockResolvedValue(false);
    await expect(resolveMcpTools("u1", ["mcp_gh_create_issue"])).rejects.toThrow(/owner/);
    expect(await resolveMcpTools("u1", [])).toEqual([]);
  });
});

describe("CLI folder and access", () => {
  it("allowEdits gives agent access, otherwise chat", async () => {
    expect(await cliFolderAccess({ folder: "/work/app", allowEdits: true })).toEqual({ cwd: "/work/app", access: "agent" });
    expect(await cliFolderAccess({ folder: "/work/app", allowEdits: false })).toEqual({ cwd: "/work/app", access: "chat" });
    expect(await cliFolderAccess({})).toEqual({ cwd: "", access: "chat" });
  });

  it("a folder outside the runnable list fails, and edits need a folder", async () => {
    isRunnableCwd.mockResolvedValue(false);
    await expect(cliFolderAccess({ folder: "/etc", allowEdits: true })).rejects.toThrow(/isn't a folder/);
    await expect(cliFolderAccess({ allowEdits: true })).rejects.toThrow(/needs a working folder/);
  });
});

const node = (id: string, fromIds: string[], type: FlowNode["type"], config: Record<string, unknown>): FlowNode => ({ id, type, fromIds, config, ui: { label: id, position: { x: 0, y: 0 } } });
const graphOf = (...nodes: FlowNode[]): WorkflowGraph => ({ ...emptyGraph("m"), nodes: [emptyGraph().nodes[0], ...nodes] });
const reader = node("reader", ["trigger"], "agent", { instructions: "x", tools: ["readChat"] });

describe("MCP counts as reaching the web", () => {
  it("an mcpTool card, and an agent with any MCP tool, reach the web", () => {
    expect(reachesWeb("mcpTool", {})).toBe(true);
    expect(reachesWeb("agent", { mcpTools: ["mcp_a_b"] })).toBe(true);
    expect(reachesWeb("agent", { mcpTools: [] })).toBe(false);
  });

  it("refuses a chat-reading card upstream of an MCP tool card", () => {
    const g = graphOf(reader, node("push", ["reader"], "mcpTool", { serverId: "s1", tool: "t" }));
    expect(chatLeaks(g).map((l) => l.nodeId)).toEqual(["reader"]);
    expect(validateStructure(g).join()).toMatch(/reads your chats and a later card reaches the web/);
    expect(checkGraph(g).some((i) => /reads your chats/.test(i.message))).toBe(true);
  });

  it("refuses a chat-reading card upstream of an agent with an MCP tool", () => {
    const g = graphOf(reader, node("act", ["reader"], "agent", { instructions: "x", mcpTools: ["mcp_a_b"] }));
    expect(chatLeaks(g)).toHaveLength(1);
    expect(validateStructure(g).length).toBeGreaterThan(0);
  });

  it("refuses chat-reading and MCP on the same agent card", () => {
    expect(hasToolConflict(["readChat"], ["mcp_a_b"])).toBe(true);
    expect(hasToolConflict(["calculator"], ["mcp_a_b"])).toBe(false);
    const g = graphOf(node("both", ["trigger"], "agent", { instructions: "x", tools: ["searchChats"], mcpTools: ["mcp_a_b"] }));
    expect(validateStructure(g).join()).toMatch(/read your chats and reach the web/);
  });

  it("allows an MCP card that does not follow a chat reader", () => {
    expect(validateStructure(graphOf(node("push", ["trigger"], "mcpTool", { serverId: "s1", tool: "t" })))).toEqual([]);
  });
});
