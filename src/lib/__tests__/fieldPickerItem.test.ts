import { describe, it, expect } from "vitest";
import { itemListOf } from "@/lib/workflows/catalog";
import { pickerRows } from "@/app/workflows/components/FieldPicker";
import { emptyGraph, type FlowNode } from "@/lib/workflows/graph";

describe("{{item}} in the field picker", () => {
  it("a per-item card takes its list from Items; Filter and Save to table take it from List; others have none", () => {
    expect(itemListOf("agent", { perItem: true, items: "{{a.items}}" })).toBe("{{a.items}}");
    expect(itemListOf("agent", { perItem: false, items: "{{a.items}}" })).toBeUndefined();
    expect(itemListOf("filter", { list: "{{s.items}}" })).toBe("{{s.items}}");
    expect(itemListOf("table", { list: "{{s.inserted}}" })).toBe("{{s.inserted}}");
    expect(itemListOf("chatMessage", {})).toBeUndefined();
  });

  it("offers item.<field> rows for a Filter, from the first item of its list", () => {
    const g = emptyGraph("m");
    const filter: FlowNode = { id: "keep", type: "filter", fromIds: ["trigger"], config: { list: "{{s.items}}" }, ui: { label: "Keep", position: { x: 1, y: 0 } } };
    g.nodes.push(filter);
    const rows = pickerRows({ graph: g, node: filter, perItem: itemListOf("filter", filter.config) !== undefined, outputs: {}, sampleItem: { title: "T", score: 7 } });
    expect(rows.filter((r) => r.group === "This item").map((r) => r.path)).toEqual(["item", "item.title", "item.score", "index"]);
    expect(rows.find((r) => r.path === "item.score")?.sample).toBe("7");
  });
});
