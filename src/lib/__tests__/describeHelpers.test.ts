import { describe, expect, it } from "vitest";
import { generateErrorMessage, previewLabel } from "@/lib/workflows/describe";
import type { WorkflowGraph } from "@/lib/workflows/graph";

describe("describe helpers", () => {
  it("uses the server's message, else a plain one for the status", () => {
    expect(generateErrorMessage(409, "Busy now.")).toBe("Busy now.");
    expect(generateErrorMessage(504)).toMatch(/too long/);
    expect(generateErrorMessage(422, "  ")).toMatch(/Couldn't build a flow/);
    expect(generateErrorMessage(500)).toMatch(/Try again/);
  });
  it("counts cards in the preview label", () => {
    const g = (n: number) => ({ nodes: Array.from({ length: n }) }) as unknown as WorkflowGraph;
    expect(previewLabel(g(6))).toBe("Preview · 6 cards");
    expect(previewLabel(g(1))).toBe("Preview · 1 card");
  });
});
