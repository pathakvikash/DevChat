import { describe, it, expect } from "vitest";
import { CATALOG, reachesWeb } from "@/lib/workflows/catalog";
import { chatLeaks, checkGraph, emptyGraph, validateStructure, type FlowNode, type WorkflowGraph } from "@/lib/workflows/graph";

const node = (id: string, fromIds: string[], x: number, type: FlowNode["type"], config: Record<string, unknown> = {}): FlowNode => ({
  id,
  type,
  fromIds,
  config,
  ui: { label: id, position: { x, y: 0 } },
});
const graphOf = (...nodes: FlowNode[]): WorkflowGraph => ({ ...emptyGraph("m"), nodes: [emptyGraph().nodes[0], ...nodes] });

describe("phase 2 cards in the graph checks", () => {
  const reader = node("read", ["trigger"], 1, "agent", { instructions: "x", tools: ["readChat"] });
  const leak = "read reads your chats and a later card reaches the web. Split them into two workflows, so a web page can't make it send your chats out.";

  it("a Fetch card counts as reaching the web", () => {
    expect(reachesWeb("fetch", {})).toBe(true);
    expect(reachesWeb("filter", {})).toBe(false);
    expect(reachesWeb("table", {})).toBe(false);
    const g = graphOf(reader, node("page", ["read"], 2, "fetch", { url: "https://a.test" }));
    expect(validateStructure(g)).toContain(leak);
    expect(chatLeaks(g)).toEqual([{ nodeId: "read", message: leak }]);
  });

  it("a Filter or Table after a chat reader, and a Fetch before it, are fine", () => {
    expect(validateStructure(graphOf(reader, node("f", ["read"], 2, "filter", { list: "{{read.items}}" })))).toEqual([]);
    expect(validateStructure(graphOf(reader, node("t", ["read"], 2, "table", { tableId: "t1", list: "{{read.items}}" })))).toEqual([]);
    const before = graphOf(node("page", ["trigger"], 1, "fetch", { url: "https://a.test" }), node("read", ["page"], 2, "agent", { instructions: "x", tools: ["readChat"] }));
    expect(validateStructure(before)).toEqual([]);
  });

  it("lets Filter rules and Save to table columns use {{item}} without per-item, but not their list", () => {
    const g = graphOf(
      node("search", ["trigger"], 1, "webSearch", { queries: "x" }),
      node("keep", ["search"], 2, "filter", { list: "{{search.items}}", rules: [{ field: "{{item.title}}", op: "contains", value: "{{vars.word}}" }] }),
      node("save", ["keep"], 3, "table", { tableId: "t1", list: "{{keep.items}}", fields: [{ column: "t", value: "{{item.title}}" }], status: "{{item.fit}}" }),
    );
    g.vars = [{ key: "word", label: "", value: "x" }];
    expect(checkGraph(g)).toEqual([]);
    const bad = graphOf(node("search", ["trigger"], 1, "webSearch", { queries: "x" }), node("keep", ["search"], 2, "filter", { list: "{{item.items}}" }));
    expect(checkGraph(bad).map((i) => i.message).join()).toContain('needs "Run once per item"');
  });

  it("checks references inside rules", () => {
    const g = graphOf(node("keep", ["trigger"], 1, "filter", { list: "{{trigger.x}}", rules: [{ field: "{{ghost.a}}", op: "eq", value: "1" }] }));
    expect(checkGraph(g).map((i) => i.message).join()).toContain("{{ghost.a}} refers to a card that does not exist");
  });

  it("asks for a URL, a list and a table", () => {
    const g = graphOf(node("page", ["trigger"], 1, "fetch"), node("keep", ["page"], 2, "filter"), node("save", ["keep"], 3, "table"));
    const msgs = checkGraph(g).map((i) => i.message);
    expect(msgs).toContain("page: add a URL");
    expect(msgs.filter((m) => m.includes("add the list to work on"))).toHaveLength(2);
    expect(msgs).toContain("save: pick a table");
  });

  it("gives each new card its outputs for the field picker", () => {
    expect(CATALOG.table.outputs({})).toEqual(["inserted", "updated", "items", "missing"]);
    expect(CATALOG.filter.outputs({})).toEqual(["items", "count", "removed"]);
    expect(CATALOG.fetch.outputs({ as: "feed" })).toEqual(["title", "items", "count"]);
    expect(CATALOG.fetch.outputs({ as: "json" })).toEqual(["data"]);
    expect(CATALOG.fetch.outputs({ as: "page" })).toEqual(["url", "text"]);
    expect(CATALOG.fetch.outputs({ perItem: true })).toEqual(["items", "count", "failed"]);
  });
});
