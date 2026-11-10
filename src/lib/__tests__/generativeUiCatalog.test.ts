import { describe, expect, it } from "vitest";
import { catalog } from "@/lib/generativeUi/catalog";

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
