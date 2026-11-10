import { describe, expect, it } from "vitest";
import { orphanSides, sideShares } from "@/lib/splitPanes";
import {
  clampWidths,
  closePane,
  equalShares,
  fitsSideBySide,
  isPaneBusy,
  maxPanesForWidth,
  nextPane,
  openPane,
  parsePanes,
  replacePane,
  resizeDivider,
  serializePanes,
  writerConflicts,
} from "@/lib/splitPanes";

const q = (s: string) => new URLSearchParams(s);

describe("parsePanes", () => {
  it("reads the first pane from the path", () => {
    expect(parsePanes("/c/A", q(""))).toEqual({ ids: ["A"], focus: "A" });
  });

  it("reads split and focus", () => {
    expect(parsePanes("/c/A", q("split=B,C&focus=C"))).toEqual({ ids: ["A", "B", "C"], focus: "C" });
  });

  it("falls back to the first pane when focus is not open", () => {
    expect(parsePanes("/c/A", q("split=B&focus=Z"))).toEqual({ ids: ["A", "B"], focus: "A" });
  });

  it("drops duplicates, the first id repeated, empty and malformed ids", () => {
    expect(parsePanes("/c/A", q("split=B,B,A,,b%20x,C"))).toEqual({ ids: ["A", "B", "C"], focus: "A" });
  });

  it("returns no panes for /c/new and other paths", () => {
    expect(parsePanes("/c/new", q("split=B"))).toEqual({ ids: [], focus: "" });
    expect(parsePanes("/settings", q(""))).toEqual({ ids: [], focus: "" });
  });
});

describe("serializePanes", () => {
  it("writes a single chat as its path", () => {
    expect(serializePanes(["A"], "A")).toBe("/c/A");
  });

  it("leaves focus out when the first pane is focused", () => {
    expect(serializePanes(["A", "B", "C"], "A")).toBe("/c/A?split=B,C");
  });

  it("writes focus when another pane is focused", () => {
    expect(serializePanes(["A", "B", "C"], "B")).toBe("/c/A?split=B,C&focus=B");
  });

  it("keeps other params such as q", () => {
    expect(serializePanes(["A", "B"], "A", q("q=hi&split=X&focus=X"))).toBe("/c/A?split=B&q=hi");
  });

  it("round-trips through parsePanes", () => {
    const href = serializePanes(["A", "B", "C"], "C", q("q=x"));
    const [path, query] = href.split("?");
    expect(parsePanes(path, q(query))).toEqual({ ids: ["A", "B", "C"], focus: "C" });
  });
});

describe("maxPanesForWidth and fitsSideBySide", () => {
  it("sets the opening limit by window width", () => {
    expect(maxPanesForWidth(767)).toBe(1);
    expect(maxPanesForWidth(768)).toBe(2);
    expect(maxPanesForWidth(1439)).toBe(2);
    expect(maxPanesForWidth(1440)).toBe(3);
  });

  it("needs 360px per pane side by side", () => {
    expect(fitsSideBySide(2, 720)).toBe(true);
    expect(fitsSideBySide(2, 719)).toBe(false);
    expect(fitsSideBySide(1, 100)).toBe(true);
  });
});

describe("openPane", () => {
  it("opens right of index 0 and left of index 0", () => {
    expect(openPane(["A"], "X", { index: 0, side: "right" }, 3)).toEqual(["A", "X"]);
    expect(openPane(["A"], "X", { index: 0, side: "left" }, 3)).toEqual(["X", "A"]);
  });

  it("leaves the list alone when the chat is already open", () => {
    expect(openPane(["A", "B"], "B", { index: 0, side: "right" }, 3)).toEqual(["A", "B"]);
  });

  it("returns full at the limit", () => {
    expect(openPane(["A", "B"], "X", { index: 1, side: "right" }, 2)).toBe("full");
  });
});

describe("closePane", () => {
  it("closes a middle pane and focuses its left neighbour", () => {
    expect(closePane(["A", "B", "C"], "B", "B")).toEqual({ ids: ["A", "C"], focus: "A" });
  });

  it("promotes the next pane when the first is closed", () => {
    expect(closePane(["A", "B", "C"], "A", "A")).toEqual({ ids: ["B", "C"], focus: "B" });
  });

  it("keeps focus where it is when another pane closes", () => {
    expect(closePane(["A", "B", "C"], "C", "B")).toEqual({ ids: ["A", "B"], focus: "B" });
  });

  it("does nothing to the last pane", () => {
    expect(closePane(["A"], "A")).toEqual({ ids: ["A"], focus: "A" });
  });
});

describe("replacePane", () => {
  it("swaps in place and focuses the new chat", () => {
    expect(replacePane(["A", "B", "C"], "B", "X")).toEqual({ ids: ["A", "X", "C"], focus: "X" });
  });

  it("focuses an open chat instead of duplicating it", () => {
    expect(replacePane(["A", "B", "C"], "B", "C")).toEqual({ ids: ["A", "B", "C"], focus: "C" });
  });
});

describe("nextPane", () => {
  it("moves forward and backward with wrap-around", () => {
    expect(nextPane(["A", "B", "C"], "C", 1)).toBe("A");
    expect(nextPane(["A", "B", "C"], "A", -1)).toBe("C");
    expect(nextPane(["A", "B", "C"], "A", 1)).toBe("B");
  });

  it("returns the only pane for one pane", () => {
    expect(nextPane(["A"], "A", 1)).toBe("A");
  });
});

describe("clampWidths and equalShares", () => {
  it("gives every pane at least 360px", () => {
    const out = clampWidths([0.1, 0.9], 1000);
    expect(out[0]).toBeCloseTo(0.36);
    expect(out[1]).toBeCloseTo(0.64);
  });

  it("keeps fractions summing to 1", () => {
    const out = clampWidths([0.05, 0.05, 0.9], 1200);
    expect(out.reduce((s, x) => s + x, 0)).toBeCloseTo(1);
    for (const x of out) expect(x * 1200).toBeGreaterThanOrEqual(359.999);
  });

  it("returns equal shares when the area cannot fit every minimum", () => {
    expect(clampWidths([0.2, 0.8], 600)).toEqual([0.5, 0.5]);
  });

  it("equalShares(3) gives three thirds", () => {
    expect(equalShares(3)).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it("resizeDivider moves only the two neighbours and keeps the minimum", () => {
    expect(resizeDivider([0.5, 0.5], 0, 100, 1000)[0]).toBeCloseTo(0.6);
    expect(resizeDivider([0.5, 0.5], 0, 100, 1000)[1]).toBeCloseTo(0.4);
    expect(resizeDivider([0.4, 0.4, 0.2], 0, 50, 1000)).toEqual([expect.closeTo(0.44), expect.closeTo(0.36), 0.2]);
    expect(resizeDivider([0.5, 0.5], 0, -1000, 1000)[0]).toBeCloseTo(0.36);
  });
});

describe("isPaneBusy", () => {
  const idle = { streaming: false, input: "", quotes: 0, files: 0, queued: 0 };

  it("is busy while streaming or holding any unsent work", () => {
    expect(isPaneBusy({ ...idle, streaming: true })).toBe(true);
    expect(isPaneBusy({ ...idle, input: "draft" })).toBe(true);
    expect(isPaneBusy({ ...idle, quotes: 1 })).toBe(true);
    expect(isPaneBusy({ ...idle, files: 1 })).toBe(true);
    expect(isPaneBusy({ ...idle, queued: 1 })).toBe(true);
  });

  it("is idle when empty", () => {
    expect(isPaneBusy(idle)).toBe(false);
    expect(isPaneBusy({ ...idle, input: "   " })).toBe(false);
  });
});

describe("writerConflicts", () => {
  const pane = (id: string, mode: string, workingFolder: string | null = "/repo", kind = "chat") => ({
    id,
    kind,
    mode,
    workingFolder,
  });

  it("flags two agent panes on one folder", () => {
    expect([...writerConflicts([pane("A", "agent"), pane("B", "agent")])].sort()).toEqual(["A", "B"]);
  });

  it("ignores an agent and a chat pane", () => {
    expect(writerConflicts([pane("A", "agent"), pane("B", "chat")]).size).toBe(0);
  });

  it("counts ask as a writer", () => {
    expect(writerConflicts([pane("A", "ask"), pane("B", "agent")]).size).toBe(2);
  });

  it("never flags null folders", () => {
    expect(writerConflicts([pane("A", "agent", null), pane("B", "agent", null)]).size).toBe(0);
  });

  it("never counts side chats", () => {
    expect(writerConflicts([pane("A", "agent"), pane("B", "agent", "/repo", "side")]).size).toBe(0);
  });

  it("flags only the two that share a folder out of three", () => {
    const out = writerConflicts([pane("A", "agent"), pane("B", "agent", "/other"), pane("C", "agent")]);
    expect([...out].sort()).toEqual(["A", "C"]);
  });
});

describe("orphanSides", () => {
  it("returns the open side chats of the closing main chat", () => {
    expect(orphanSides(["A", "B", "C"], { B: "A" }, "A")).toEqual(["B"]);
  });

  it("returns none when the closing pane has no side chat open", () => {
    expect(orphanSides(["A", "B", "C"], { C: "A" }, "B")).toEqual([]);
  });

  it("ignores a side chat whose parent is not the closing pane", () => {
    expect(orphanSides(["A", "B", "C"], { C: "B" }, "A")).toEqual([]);
  });
});

describe("sideShares", () => {
  it("gives a compact side chat about 400px and the rest the row", () => {
    const [main, side] = sideShares([false, true], [false, false], 1000);
    expect(side).toBeCloseTo(0.4);
    expect(main).toBeCloseTo(0.6);
  });

  it("gives a wide side chat half the row, and leaves the no-side layout equal", () => {
    expect(sideShares([false, true], [false, true], 1000)).toEqual([0.5, 0.5]);
    expect(sideShares([false, false], [false, false], 1000)).toEqual([0.5, 0.5]);
  });
});
