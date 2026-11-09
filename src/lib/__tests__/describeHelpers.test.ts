import { describe, expect, it } from "vitest";
import { generateErrorMessage, mergeVars, previewLabel } from "@/lib/workflows/describe";
import type { WorkflowGraph } from "@/lib/workflows/graph";

describe("describe helpers", () => {
  it("uses the server's message, else a plain one for the status", () => {
    expect(generateErrorMessage(409, "Busy now.")).toBe("Busy now.");
    expect(generateErrorMessage(504)).toMatch(/too long/);
    expect(generateErrorMessage(422, "  ")).toMatch(/Couldn't build a flow/);
    expect(generateErrorMessage(500)).toMatch(/Try again/);
  });
  it("merges variables on Apply", () => {
    const v = (key: string, value: string) => ({ key, label: key, value });
    const merged = mergeVars([v("a", "mine"), v("b", ""), v("old", "keep")], [v("a", "model"), v("b", "model-b"), v("c", "new")]);
    expect(merged.map((x) => [x.key, x.value])).toEqual([["a", "mine"], ["b", "model-b"], ["c", "new"], ["old", "keep"]]);
  });
  it("counts cards in the preview label", () => {
    const g = (n: number) => ({ nodes: Array.from({ length: n }) }) as unknown as WorkflowGraph;
    expect(previewLabel(g(6))).toBe("Preview · 6 cards");
    expect(previewLabel(g(1))).toBe("Preview · 1 card");
  });
});
