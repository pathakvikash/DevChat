import { describe, expect, it } from "vitest";
import { catalog } from "@/lib/generativeUi/catalog";
import { boundFieldPaths, boundValues, composeUiSubmit, sanitizeSpec } from "@/lib/generativeUi/composeSubmit";

// `catalog.data` is the definition object handed to defineCatalog, so the raw
// zod4 prop schemas are reachable without exporting them separately.
const chart = catalog.data.components.Chart.props;
const table = catalog.data.components.Table.props;

const nulls = {
  data: null,
  dataArtifactId: null,
  labelColumn: null,
  valueColumn: null,
  headers: null,
  rows: null,
  columns: null,
};

describe("generative UI catalog: data-driven Chart/Table", () => {
  it("Chart accepts a dataArtifactId with no inline data", () => {
    expect(
      chart.safeParse({ ...nulls, type: "bar", title: "Sales", dataArtifactId: "art_1", valueColumn: "revenue" })
        .success,
    ).toBe(true);
  });

  it("Chart still accepts inline data", () => {
    expect(
      chart.safeParse({ ...nulls, type: "pie", title: null, data: [{ label: "a", value: 1 }] }).success,
    ).toBe(true);
  });

  it("Chart still requires a chart type", () => {
    expect(chart.safeParse({ ...nulls, dataArtifactId: "art_1" }).success).toBe(false);
  });

  it("Table accepts a dataArtifactId with no inline rows", () => {
    expect(table.safeParse({ ...nulls, dataArtifactId: "art_1", columns: ["a", "b"] }).success).toBe(true);
  });

  it("Table still accepts inline headers and rows", () => {
    expect(table.safeParse({ ...nulls, headers: ["a"], rows: [["1"]] }).success).toBe(true);
  });
});

describe("generative UI submit action", () => {
  it("is advertised in the prompt", () => {
    expect(catalog.prompt()).toContain("submit");
  });

  it("composes client-side text from values", () => {
    expect(composeUiSubmit({ name: "Ann", ok: true })).toBe("Form submitted:\nname: Ann\nok: true");
  });

  it("sanitizeSpec strips watch everywhere and keeps only a Button's press -> submit", () => {
    const spec = sanitizeSpec({
      elements: {
        i: { type: "Input", props: { value: { $bindState: "/f/a" } }, watch: { "/f/a": { action: "submit" } }, on: { press: { action: "submit" } } },
        b: { type: "Button", props: {}, watch: { "/f/a": { action: "submit" } }, on: { press: { action: "submit", params: { values: { x: "evil" } } }, change: { action: "submit" } } },
        c: { type: "Button", props: {}, on: { press: { action: "setState" } } },
      },
    });
    expect(spec.elements.i.watch).toBeUndefined();
    expect(spec.elements.i.on).toBeUndefined();
    expect(spec.elements.b.watch).toBeUndefined();
    expect(spec.elements.b.on).toEqual({ press: { action: "submit" } });
    expect(spec.elements.c.on).toBeUndefined();
  });

  it("sends only values bound by rendered inputs, read from state, never literals", () => {
    const spec = {
      root: "r",
      elements: {
        r: { type: "Stack", children: ["i", "k", "t"] },
        i: { type: "Input", props: { value: { $bindState: "/form/name" } } },
        k: { type: "Checkbox", props: { checked: { $bindState: "/form/ok" } } },
        t: { type: "Text", props: { content: { $bindState: "/form/secret" } } },
      },
    };
    const paths = boundFieldPaths(spec);
    expect(paths.sort()).toEqual(["/form/name", "/form/ok"]);
    const state = { form: { name: "Ann", ok: true, secret: "no", injected: "attacker text" } };
    expect(composeUiSubmit(boundValues(state, paths))).toBe("Form submitted:\nform.name: Ann\nform.ok: true");
    expect(composeUiSubmit(boundValues({}, paths))).toBeNull();
  });

  it("ignores inputs that are orphaned or hidden by visible: false", () => {
    const input = (p: string, extra = {}) => ({ type: "Input", props: { value: { $bindState: p } }, ...extra });
    const spec = {
      root: "r",
      elements: {
        r: { type: "Stack", children: ["shown", "hidden", "wrap"] },
        shown: input("/a"),
        hidden: input("/b", { visible: false }),
        wrap: { type: "Stack", visible: false, children: ["inner"] },
        inner: input("/c"),
        orphan: input("/d"),
      },
    };
    expect(boundFieldPaths(spec)).toEqual(["/a"]);
  });

  it("the submit action takes no params", () => {
    expect(catalog.data.actions.submit.params.safeParse({}).success).toBe(true);
    expect(catalog.prompt()).not.toContain('"values"');
  });

  it("caps values and total, rejects non-objects", () => {
    expect(composeUiSubmit({ a: "x".repeat(5000) })!.length).toBeLessThan(2100);
    const big = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, "y".repeat(2000)]));
    expect(composeUiSubmit(big)!.length).toBeLessThan(8200);
    expect(composeUiSubmit(null)).toBeNull();
    expect(composeUiSubmit({})).toBeNull();
    expect(composeUiSubmit(["a"])).toBeNull();
  });
});
