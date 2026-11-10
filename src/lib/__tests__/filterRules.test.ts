import { describe, it, expect } from "vitest";
import { applyRules, testRule, type FilterRule } from "@/lib/workflows/filterRules";
import { filterCard } from "@/lib/workflows/cards/filter";
import type { CardCtx } from "@/lib/workflows/cards";
import type { TemplateContext } from "@/lib/workflows/template";

const ctx = (nodes: Record<string, unknown> = {}, vars: Record<string, string> = {}): TemplateContext => ({
  nodes,
  vars,
  run: { id: "r", date: "2026-11-09", startedAt: "" },
  workflow: { name: "W" },
});
const rule = (field: string, op: FilterRule["op"], value = ""): FilterRule => ({ field, op, value });

describe("testRule", () => {
  it("compares as numbers when both sides are numbers, even a number in text", () => {
    expect(testRule("gt", 100, "9")).toBe(true); // as strings "100" < "9"
    expect(testRule("gte", "60", "60")).toBe(true);
    expect(testRule("lt", 5, "10")).toBe(true);
    expect(testRule("lte", 10, "10.0")).toBe(true);
    expect(testRule("eq", "72", "72.0")).toBe(true);
    expect(testRule("neq", 72, "73")).toBe(true);
  });

  it("falls back to case-insensitive strings", () => {
    expect(testRule("eq", "Shortlist", "shortlist")).toBe(true);
    expect(testRule("neq", "skip", "SKIP")).toBe(false);
    expect(testRule("gt", "b", "a")).toBe(true);
    expect(testRule("lt", "abc", "10")).toBe(false);
  });

  it("contains and not contains ignore case and read lists as JSON text", () => {
    expect(testRule("contains", "Senior Frontend Engineer", "frontend")).toBe(true);
    expect(testRule("notContains", "Senior Frontend Engineer", "intern")).toBe(true);
    expect(testRule("contains", ["rust", "go"], "Go")).toBe(true);
  });

  it("empty means nothing, an empty string or an empty list", () => {
    for (const v of [undefined, null, "", []]) {
      expect(testRule("empty", v, "")).toBe(true);
      expect(testRule("notEmpty", v, "")).toBe(false);
    }
    expect(testRule("empty", 0, "")).toBe(false);
    expect(testRule("notEmpty", "x", "")).toBe(true);
  });
});

describe("applyRules", () => {
  const list = [
    { title: "A", score: 80, fit: "shortlist" },
    { title: "B", score: 40, fit: "skip" },
    { title: "C", score: 65, fit: "skip" },
  ];

  it("keeps everything when there are no rules", () => {
    expect(applyRules(list, [], "all", ctx())).toEqual(list);
  });

  it("all: every rule must pass. any: one is enough", () => {
    const rules = [rule("{{item.score}}", "gte", "60"), rule("{{item.fit}}", "eq", "shortlist")];
    expect(applyRules(list, rules, "all", ctx()).map((i: any) => i.title)).toEqual(["A"]);
    expect(applyRules(list, rules, "any", ctx()).map((i: any) => i.title)).toEqual(["A", "C"]);
  });

  it("renders the value side with variables and other cards", () => {
    const rules = [rule("{{item.score}}", "gt", "{{vars.min}}")];
    expect(applyRules(list, rules, "all", ctx({}, { min: "50" })).map((i: any) => i.title)).toEqual(["A", "C"]);
  });

  it("an item missing the field is empty, so it fails a comparison with a number only as a string", () => {
    expect(applyRules([{ x: 1 }], [rule("{{item.score}}", "empty")], "all", ctx())).toHaveLength(1);
    expect(applyRules([{ x: 1 }], [rule("{{item.score}}", "gte", "1")], "all", ctx())).toHaveLength(0);
  });

  it("gives an empty list back as it is", () => {
    expect(applyRules([], [rule("{{item.a}}", "notEmpty")], "any", ctx())).toEqual([]);
  });
});

describe("the filter card", () => {
  const run = (config: Record<string, unknown>, nodes: Record<string, unknown>) =>
    filterCard.run({
      node: { id: "fresh", type: "filter", fromIds: [], config, ui: { label: "New articles", position: { x: 0, y: 0 } } },
      config: { rules: [], match: "all", stopIfEmpty: true, ...config },
      tctx: ctx(nodes),
    } as unknown as CardCtx);

  it("returns the items that pass, the count and how many were removed", async () => {
    const r = await run({ list: "{{s.items}}", rules: [rule("{{item.score}}", "gte", "60")] }, { s: { items: [{ score: 80 }, { score: 10 }] } });
    expect(r.output).toEqual({ items: [{ score: 80 }], count: 1, removed: 1 });
    expect(r.stop).toBeUndefined();
  });

  it("with nothing left it is done but stops what follows, with the card's name", async () => {
    const r = await run({ list: "{{s.items}}" }, { s: { items: [] } });
    expect(r.output).toEqual({ items: [], count: 0, removed: 0 });
    expect(r.stop).toBe("Nothing left after New articles");
  });

  it("does not stop when stopIfEmpty is off", async () => {
    const r = await run({ list: "{{s.items}}", stopIfEmpty: false }, { s: { items: [] } });
    expect(r.stop).toBeUndefined();
  });

  it("fails when the list is not a list", async () => {
    await expect(run({ list: "{{s.items}}" }, { s: { items: "nope" } })).rejects.toThrow(/needs a list/);
    await expect(run({ list: "{{missing.items}}" }, {})).rejects.toThrow(/needs a list/);
  });
});
