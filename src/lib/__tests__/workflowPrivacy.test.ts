import { describe, it, expect } from "vitest";
import { emptyGraph, type FlowNode, type WorkflowGraph } from "@/lib/workflows/graph";
import { privateKindsOf, PRIVATE_KINDS, joinKinds, kindsText, parseKinds, planKinds, webAfter } from "@/lib/workflows/privacy";

const node = (id: string, type: FlowNode["type"], fromIds: string[], x: number, config: Record<string, unknown> = {}): FlowNode => ({ id, type, fromIds, config, ui: { label: id, position: { x, y: 0 } } });
const graphOf = (...nodes: FlowNode[]): WorkflowGraph => ({ ...emptyGraph("m"), nodes: [emptyGraph().nodes[0], ...nodes] });
const reader = node("read", "agent", ["trigger"], 1, { instructions: "x", tools: ["readChat"] });
const save = (id: string, from: string[], x: number, tableId: string) => node(id, "table", from, x, { tableId, list: "{{trigger.items}}" });

describe("kinds", () => {
  it("parse, join and name a set of kinds", () => {
    expect(parseKinds("")).toEqual([]);
    expect(parseKinds(" chats, mcp,chats ")).toEqual(["chats", "mcp"]);
    expect(joinKinds(["mcp", "chats", "chats"])).toBe("chats,mcp");
    expect(kindsText(["chats"])).toBe("chats");
    expect(kindsText(["chats", "mcp", "folder"])).toBe("chats, MCP and a folder");
  });
});

describe("planKinds", () => {
  const none = new Map([["t1", [] as string[]], ["t2", [] as string[]], ["t3", [] as string[]]]);

  it("a Save after a chat reader takes chats; a Save before it, or beside it, does not", () => {
    const p = planKinds(graphOf(reader, save("a", ["read"], 2, "t1"), save("b", ["trigger"], 3, "t2")), none);
    expect(p.get("t1")).toEqual(["chats"]);
    expect(p.get("t2")).toEqual([]);
  });

  it("a Save on a private table is a reader: the next table inherits its kinds, through any number of copies", () => {
    const p = planKinds(graphOf(save("a", ["trigger"], 1, "t1"), save("b", ["a"], 2, "t2"), save("c", ["b"], 3, "t3")), new Map([["t1", ["chats", "mcp"]], ["t2", []], ["t3", []]]));
    expect(p.get("t2")).toEqual(["chats", "mcp"]);
    expect(p.get("t3")).toEqual(["chats", "mcp"]);
  });

  it("reaches a fixed point when copies run against the card order", () => {
    // c is placed first on the canvas but fed by b, which is fed by the reader
    const p = planKinds(graphOf(save("c", ["b"], 0, "t3"), reader, save("b", ["read"], 5, "t2")), none);
    expect(p.get("t3")).toEqual(["chats"]);
  });

  it("two Save cards on one table: the kinds union", () => {
    const p = planKinds(graphOf(reader, save("a", ["read"], 2, "t1"), save("b", ["trigger"], 3, "t1")), none);
    expect(p.get("t1")).toEqual(["chats"]);
  });

  it("webAfter lists the web cards downstream", () => {
    const g = graphOf(save("a", ["trigger"], 1, "t1"), node("page", "fetch", ["a"], 2, { url: "https://a.test" }), node("side", "fetch", ["trigger"], 3, { url: "https://a.test" }));
    expect(webAfter(g, "a", ["chats"]).map((n) => n.id)).toEqual(["page"]);
  });
});

const mcp = (id: string, from: string[], x: number) => node(id, "mcpTool", from, x, { serverId: "s1", tool: "post" });
const page = (id: string, from: string[], x: number) => node(id, "fetch", from, x, { url: "https://a.test" });

describe("kinds from phase 6 readers", () => {
  it("names chats, mcp and folder", () => {
    expect([...PRIVATE_KINDS]).toEqual(["chats", "mcp", "folder"]);
    expect(privateKindsOf("agent", { tools: ["readChat"] })).toEqual(["chats"]);
    expect(privateKindsOf("mcpTool", {})).toEqual(["mcp"]);
    expect(privateKindsOf("agent", { mcpTools: ["mcp__s1__x"] })).toEqual(["mcp"]);
    expect(privateKindsOf("agent", { folder: "/p", model: "claude-code/default" })).toEqual(["folder"]);
    expect(privateKindsOf("agent", { folder: "/p", model: "" }, "claude-code/default")).toEqual(["folder"]); // the workflow's default model
    expect(privateKindsOf("agent", { folder: "/p", model: "openai/gpt" })).toEqual([]);
    expect(privateKindsOf("agent", { tools: ["readChat"], mcpTools: ["mcp__s1__x"] }).sort()).toEqual(["chats", "mcp"]);
  });

  it("a CLI-folder agent on the workflow default model marks a table folder", () => {
    const g = { ...graphOf(node("cli", "agent", ["trigger"], 1, { instructions: "x", folder: "/p", model: "" }), save("keep", ["cli"], 2, "t1")), defaultModel: "claude-code/default" };
    expect(planKinds(g, new Map([["t1", []]])).get("t1")).toEqual(["folder"]);
    expect(planKinds({ ...g, defaultModel: "openai/gpt" }, new Map([["t1", []]])).get("t1")).toEqual([]);
  });

  it("a table filled from MCP only: an MCP card may follow it, Fetch and Web search may not", () => {
    const g = graphOf(mcp("read", ["trigger"], 1), save("keep", ["read"], 2, "t1"), mcp("post", ["keep"], 3), page("page", ["keep"], 4));
    expect(planKinds(g, new Map([["t1", []]])).get("t1")).toEqual(["mcp"]);
    expect(webAfter(g, "keep", ["mcp"]).map((n) => n.id)).toEqual(["page"]);
  });

  it("a table filled from chats or a folder, or from MCP and chats: no MCP card may follow either", () => {
    const g = graphOf(save("keep", ["trigger"], 2, "t1"), mcp("post", ["keep"], 3), page("page", ["keep"], 4));
    for (const kinds of [["chats"], ["folder"], ["chats", "mcp"], ["folder", "mcp"]]) expect(webAfter(g, "keep", kinds).map((n) => n.id).sort()).toEqual(["page", "post"]);
  });
});
