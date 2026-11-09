import { describe, it, expect } from "vitest";
import { buildTemplate } from "@/lib/workflows/templates";
import { autoLayout, checkGraph, connectionError, connectNew, emptyGraph, LAYOUT_DX, LAYOUT_DY, LOOP_MESSAGE, idFromLabel, newCard, parseGraph, topoOrder, validateStructure, type FlowNode, type WorkflowGraph } from "@/lib/workflows/graph";

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

describe("chat data flowing to a card that reaches the web", () => {
  const leak = (name: string) => `${name} reads your chats and a later card reaches the web. Split them into two workflows, so a web page can't make it send your chats out.`;
  const reader = (id: string, from: string[], x: number) => node(id, from, x, 0, "agent", { tools: ["readChat"] });

  it("refuses a later agent with an outbound tool, even through a card in between", () => {
    const g = graphOf(reader("read", ["trigger"], 1), node("mid", ["read"], 2), node("out", ["mid"], 3, 0, "agent", { tools: ["fetchUrl"] }));
    expect(validateStructure(g)).toContain(leak("read"));
    expect(checkGraph(g).find((i) => i.nodeId === "read")?.message).toBe(leak("read"));
  });

  it("refuses a later Web search card", () => {
    const g = graphOf(reader("read", ["trigger"], 1), node("search", ["read"], 2, 0, "webSearch", { queries: "{{read.text}}" }));
    expect(validateStructure(g)).toContain(leak("read"));
  });

  it("allows the web before the chat reader, a separate branch, and a later card with no outbound tool", () => {
    expect(validateStructure(graphOf(node("search", ["trigger"], 1, 0, "webSearch", { queries: "x" }), reader("read", ["search"], 2)))).toEqual([]);
    expect(validateStructure(graphOf(reader("read", ["trigger"], 1), node("other", ["trigger"], 2, 0, "webSearch", { queries: "x" })))).toEqual([]);
    expect(validateStructure(graphOf(reader("read", ["trigger"], 1), node("calc", ["read"], 2, 0, "agent", { tools: ["calculator"] })))).toEqual([]);
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

describe("autoLayout", () => {
  const at = (g: WorkflowGraph, id: string) => g.nodes.find((n) => n.id === id)!.ui.position;

  it("puts a chain one column per level, on one row", () => {
    const g = autoLayout(buildTemplate("news", "m").graph);
    expect(g.nodes.map((n) => at(g, n.id))).toEqual([0, 1, 2, 3].map((l) => ({ x: l * LAYOUT_DX, y: 0 })));
  });

  it("puts a card one column right of its furthest input, and stacks a level in run order, centred", () => {
    const g = autoLayout(graphOf(node("a", ["trigger"]), node("b", ["trigger"], 0, 50), node("c", ["a", "b"]), node("d", ["trigger"], 0, 90)));
    expect(at(g, "a").x).toBe(LAYOUT_DX);
    expect(at(g, "c").x).toBe(2 * LAYOUT_DX);
    const ys = ["a", "b", "d"].map((id) => at(g, id).y);
    expect(ys).toEqual([-LAYOUT_DY, 0, LAYOUT_DY]);
    expect(at(g, "c").y).toBe(0);
  });

  it("keeps everything else, does not mutate, and still places cards in a loop", () => {
    const g = graphOf(node("a", ["b"]), node("b", ["a"]));
    const out = autoLayout(g);
    expect(g.nodes[1].ui.position).toEqual({ x: 0, y: 0 });
    expect(out.nodes.map((n) => n.id)).toEqual(g.nodes.map((n) => n.id));
    expect(at(out, "a").x).toBe(LAYOUT_DX);
    expect(at(out, "b").x).toBe(LAYOUT_DX);
    expect(at(out, "a").y).not.toBe(at(out, "b").y);
  });
});

describe("connectionError", () => {
  const g = graphOf(node("a", ["trigger"]), node("b", ["a"]), node("orphan", []), node("reader", ["trigger"], 0, 0, "agent", { tools: ["readChat"] }), node("web", ["trigger"], 0, 0, "agent", { tools: ["fetchUrl"] }));

  it("accepts a plain connection", () => {
    expect(connectionError(g, "a", "orphan")).toBeNull();
    expect(connectionError(g, "orphan", "b")).toBeNull();
  });

  it("refuses a connection that would make a loop, to itself or back up the flow", () => {
    expect(connectionError(g, "b", "a")).toBe(LOOP_MESSAGE);
    expect(connectionError(g, "b", "b")).toBe(LOOP_MESSAGE);
    expect(connectionError(g, "b", "trigger")).toBe(LOOP_MESSAGE);
  });

  it("refuses a second connection between the same cards", () => {
    expect(connectionError(g, "a", "b")).toBe("Those cards are already connected");
  });

  it("keeps the single trigger: nothing connects into it", () => {
    expect(connectionError(g, "orphan", "trigger")).toBe("The trigger card has no inputs");
  });

  it("shows the chat-leak rule's message", () => {
    expect(connectionError(g, "reader", "web")).toMatch(/reads your chats and a later card reaches the web/);
  });
});

describe("connectNew", () => {
  const g = graphOf(node("reader", ["trigger"], 0, 0, "agent", { tools: ["readChat"] }), node("a", ["trigger"]));
  const web = (fromIds: string[]) => node("web", fromIds, 0, 0, "webSearch", { queries: "x" });

  it("keeps connections that pass the rules", () => {
    expect(connectNew(g, web(["a"]))).toMatchObject({ error: null, node: { fromIds: ["a"] } });
  });

  it("leaves a refused connection out, with the rule's message, and keeps the card", () => {
    const r = connectNew(g, web(["reader"]));
    expect(r.node.fromIds).toEqual([]);
    expect(r.error).toMatch(/reads your chats and a later card reaches the web/);
  });

  it("keeps the good connections and reports the first bad one", () => {
    const r = connectNew(g, web(["a", "reader"]));
    expect(r.node.fromIds).toEqual(["a"]);
    expect(r.error).not.toBeNull();
  });
});

describe("layout constants", () => {
  it("newCard steps by the layout column width", () => {
    const g = buildTemplate("news", "m").graph;
    expect(newCard(g, "agent").ui.position.x - g.nodes.at(-1)!.ui.position.x).toBe(LAYOUT_DX);
  });

  it("centres two cards in a level symmetrically", () => {
    const g = autoLayout(graphOf(node("a", ["trigger"]), node("b", ["trigger"], 0, 50)));
    const [a, b] = ["a", "b"].map((id) => g.nodes.find((n) => n.id === id)!.ui.position.y);
    expect(a).toBe(-b);
  });
});
