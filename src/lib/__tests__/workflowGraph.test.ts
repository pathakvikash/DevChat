import { describe, it, expect } from "vitest";
import { buildTemplate } from "@/lib/workflows/templates";
import { checkGraph, emptyGraph, idFromLabel, newCard, parseGraph, topoOrder, validateStructure, type FlowNode, type WorkflowGraph } from "@/lib/workflows/graph";

const node = (id: string, fromIds: string[], x = 0, y = 0, type: FlowNode["type"] = "agent", config: Record<string, unknown> = {}): FlowNode => ({
  id,
  type,
  fromIds,
  config: { instructions: "do it", ...config },
  ui: { label: id, position: { x, y } },
});
const graphOf = (...nodes: FlowNode[]): WorkflowGraph => ({ ...emptyGraph("m"), nodes: [emptyGraph().nodes[0], ...nodes] });

describe("validateStructure", () => {
  it("accepts the starter templates", () => {
    expect(validateStructure(emptyGraph())).toEqual([]);
    expect(validateStructure(buildTemplate("news", "m").graph)).toEqual([]);
  });

  it("needs exactly one trigger, with id trigger", () => {
    const g = graphOf();
    expect(validateStructure({ ...g, nodes: [] })).toContain("A workflow needs exactly one trigger card");
    expect(validateStructure({ ...g, nodes: [...g.nodes, { ...g.nodes[0], id: "t2" }] })).toContain("A workflow needs exactly one trigger card");
    expect(validateStructure({ ...g, nodes: [{ ...g.nodes[0], id: "start" }] }).join()).toContain('must be "trigger"');
  });

  it("rejects duplicate, malformed and reserved ids", () => {
    const errs = validateStructure(graphOf(node("a", ["trigger"]), node("a", ["trigger"]), node("Bad-Id", ["trigger"]), node("vars", ["trigger"]), node("item", ["trigger"])));
    expect(errs.join("\n")).toMatch(/"a" is used twice/);
    expect(errs.join("\n")).toMatch(/"Bad-Id" must be/);
    expect(errs.join("\n")).toMatch(/"vars" is reserved/);
    expect(errs.join("\n")).toMatch(/"item" is reserved/);
  });

  it("rejects an unknown type and a connector to a card that does not exist", () => {
    const errs = validateStructure(graphOf({ ...node("a", ["ghost"]), type: "nope" as never }));
    expect(errs.join("\n")).toMatch(/unknown type "nope"/);
    expect(errs.join("\n")).toMatch(/"ghost", which does not exist/);
  });

  it("rejects a cycle", () => {
    expect(validateStructure(graphOf(node("a", ["trigger", "b"]), node("b", ["a"])))).toContain("The cards form a loop");
  });

  it("allows at most 30 cards", () => {
    const many = Array.from({ length: 30 }, (_, i) => node(`c${i}`, ["trigger"]));
    expect(validateStructure(graphOf(...many)).join()).toMatch(/at most 30/);
  });
});

describe("topoOrder", () => {
  it("runs upstream cards first and breaks ties by position (x, then y)", () => {
    const g = graphOf(node("late", ["trigger"], 300), node("top", ["trigger"], 100, 0), node("bottom", ["trigger"], 100, 50), node("join", ["late", "top"], 500));
    expect(topoOrder(g).map((n) => n.id)).toEqual(["trigger", "top", "bottom", "late", "join"]);
    // the same graph in a different array order gives the same run order
    expect(topoOrder({ ...g, nodes: [...g.nodes].reverse() }).map((n) => n.id)).toEqual(["trigger", "top", "bottom", "late", "join"]);
  });
});

describe("checkGraph", () => {
  it("passes the News template", () => {
    expect(checkGraph(buildTemplate("news", "m").graph)).toEqual([]);
  });

  it("warns about a reference to a card that does not run before this one", () => {
    const g = graphOf(node("a", ["trigger"], 1, 0, "agent", { input: "{{b.text}}" }), node("b", ["trigger"], 2));
    expect(checkGraph(g).map((i) => i.message).join()).toMatch(/does not run before this one/);
  });

  it("warns about a reference to an unknown card and an undefined variable", () => {
    const g = graphOf(node("a", ["trigger"], 1, 0, "agent", { input: "{{ghost.x}} {{vars.nope}}" }));
    const text = checkGraph(g).map((i) => i.message).join("\n");
    expect(text).toMatch(/does not exist/);
    expect(text).toMatch(/variable "nope" is not defined/);
  });

  it("needs per-item on to use item, and a single reference in Items", () => {
    const g = graphOf(node("a", ["trigger"], 1, 0, "agent", { input: "{{item}}" }), node("b", ["trigger"], 2, 0, "agent", { perItem: true, items: "some {{trigger.date}}" }));
    const text = checkGraph(g).map((i) => `${i.nodeId}: ${i.message}`).join("\n");
    expect(text).toMatch(/a: .*needs "Run once per item"/);
    expect(text).toMatch(/b: .*Items must be one reference/);
  });
});

describe("chat-reading plus outbound tools", () => {
  const msg = "This card can read your chats and reach the web. Pick one, so a web page can't make it send your chats out.";
  it.each([["readChat", "fetchUrl"], ["searchChats", "webSearch"]])("refuses %s together with %s at save and at Run", (a, b) => {
    const g = graphOf(node("a", ["trigger"], 1, 0, "agent", { tools: [a, b] }));
    expect(validateStructure(g).join()).toContain(msg);
    expect(checkGraph(g).map((i) => i.message).join()).toContain(msg);
  });
  it("allows either side alone, and chat tools with the calculator", () => {
    for (const tools of [["readChat", "searchChats"], ["fetchUrl", "webSearch"], ["readChat", "calculator"]]) {
      expect(validateStructure(graphOf(node("a", ["trigger"], 1, 0, "agent", { tools })))).toEqual([]);
    }
  });
});

describe("helpers", () => {
  it("parses a graph and fills defaults", () => {
    const g = parseGraph(JSON.stringify({ version: 1, nodes: [] }));
    expect(g.maxRunTokens).toBe(500_000);
    expect(() => parseGraph("{")).toThrow(/not JSON/);
    expect(() => parseGraph({ version: 2, nodes: [] })).toThrow(/Invalid workflow graph/);
  });

  it("makes ids from labels, unique and never reserved", () => {
    expect(idFromLabel("Score fit", [])).toBe("score_fit");
    expect(idFromLabel("Score fit", ["score_fit"])).toBe("score_fit_2");
    expect(idFromLabel("Vars", [])).toBe("vars_card");
    expect(idFromLabel("1st", [])).toMatch(/^[a-z]/);
  });

  it("adds a card after the last one", () => {
    const g = buildTemplate("news", "m").graph;
    const c = newCard(g, "agent");
    expect(c.fromIds).toEqual(["post"]);
    expect(c.ui.position.x).toBeGreaterThan(g.nodes.at(-1)!.ui.position.x);
  });
});
