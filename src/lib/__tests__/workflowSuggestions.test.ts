import { describe, it, expect } from "vitest";
import { CATALOG, CAREERS_SUGGESTIONS } from "@/lib/workflows/catalog";
import { detectBoard } from "@/lib/workflows/jobBoards";
import { hasLine, toggleLine } from "@/lib/workflows/toggleLine";

describe("Job boards suggestions", () => {
  it("every suggested careers URL parses to a board", () => {
    expect(CAREERS_SUGGESTIONS).toHaveLength(21);
    for (const s of CAREERS_SUGGESTIONS) expect(detectBoard(s.value).ok, s.value).toBe(true);
  });
  it("only textarea fields carry suggestions", () => {
    for (const f of CATALOG.jobBoards.fields.filter((f) => f.suggestions)) expect(f.kind).toBe("textarea");
  });
});

describe("toggleLine", () => {
  it("adds to empty and non-empty text", () => {
    expect(toggleLine("", "Backend")).toBe("Backend");
    expect(toggleLine("Data\n", "Backend")).toBe("Data\nBackend");
  });
  it("removes only that line", () => {
    expect(toggleLine("Data\nBackend\nQA", "Backend")).toBe("Data\nQA");
    expect(toggleLine("Backend", "Backend")).toBe("");
  });
  it("hasLine ignores surrounding spaces", () => {
    expect(hasLine(" Backend \nQA", "Backend")).toBe(true);
    expect(hasLine("Backend end", "Backend")).toBe(false);
  });
});
