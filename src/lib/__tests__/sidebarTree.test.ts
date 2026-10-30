import { describe, it, expect } from "vitest";
import { buildSidebarTree, type TreeItem } from "@/lib/sidebarTree";

const at = (minute: number) => `2026-10-30T10:${String(minute).padStart(2, "0")}:00.000Z`;
const chat = (id: string, minute: number, forkedFromId: string | null = null, pinned = false): TreeItem => ({
  id,
  createdAt: at(minute),
  forkedFromId,
  pinned,
});
const shape = (items: TreeItem[], flat = false) =>
  buildSidebarTree(items, { flat }).map((r) => [r.item.id, r.depth, r.isLastChild] as const);

describe("buildSidebarTree", () => {
  it("returns top-level rows unchanged when nothing is forked", () => {
    expect(shape([chat("a", 3), chat("b", 2), chat("c", 1)])).toEqual([
      ["a", 0, true],
      ["b", 0, true],
      ["c", 0, true],
    ]);
  });

  it("puts a parent's forks right under it, oldest first, the last one ending the line", () => {
    // Input is newest-activity first; the forks sit in the list ahead of their parent.
    const items = [chat("f2", 5, "p"), chat("other", 4), chat("f1", 2, "p"), chat("p", 1)];
    const rows = buildSidebarTree(items);
    expect(rows.map((r) => [r.item.id, r.depth, r.isLastChild])).toEqual([
      ["other", 0, true],
      ["p", 0, true],
      ["f1", 1, false],
      ["f2", 1, true],
    ]);
    expect(rows.every((r) => r.through.length === 0)).toBe(true);
  });

  it("nests a fork of a fork and keeps the parent's line running past its grandchildren", () => {
    const items = [chat("p", 1), chat("f1", 2, "p"), chat("g", 3, "f1"), chat("f2", 4, "p")];
    const rows = buildSidebarTree(items);
    expect(rows.map((r) => [r.item.id, r.depth, r.isLastChild, r.through])).toEqual([
      ["p", 0, true, []],
      ["f1", 1, false, []],
      ["g", 2, true, [true]], // f1 has a later sibling, so level 1 continues beside g
      ["f2", 1, true, []],
    ]);
  });

  it("ends the line at the last group: no line continues beside the last fork's children", () => {
    const rows = buildSidebarTree([chat("p", 1), chat("f", 2, "p"), chat("g", 3, "f")]);
    expect(rows[2]).toMatchObject({ depth: 2, isLastChild: true, through: [false] });
  });

  it("shows a fork as a top-level row when its parent is not in the list", () => {
    // Deleted parent (forkedFromId null), a parent filtered out of the list, or one not matching.
    expect(shape([chat("orphan", 2, null), chat("fork", 3, "gone")])).toEqual([
      ["orphan", 0, true],
      ["fork", 0, true],
    ]);
  });

  it("keeps a pinned fork top-level when its parent is not pinned", () => {
    const items = [chat("f", 2, "p", true), chat("p", 1)];
    expect(shape(items)).toEqual([
      ["f", 0, true],
      ["p", 0, true],
    ]);
    // A pinned parent still holds its unpinned fork.
    expect(shape([chat("p", 1, null, true), chat("f", 2, "p")])).toEqual([
      ["p", 0, true],
      ["f", 1, true],
    ]);
  });

  it("survives a cycle: every row shown once, nothing loops", () => {
    const rows = buildSidebarTree([chat("a", 1, "b"), chat("b", 2, "a")]);
    expect(rows.map((r) => [r.item.id, r.depth])).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
  });

  it("survives a self-reference and a fork hanging off a cycle", () => {
    const rows = buildSidebarTree([chat("self", 1, "self"), chat("a", 2, "b"), chat("b", 3, "a"), chat("tail", 4, "b")]);
    expect(rows.map((r) => r.item.id).sort()).toEqual(["a", "b", "self", "tail"]);
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.item.id === "self")?.depth).toBe(0);
  });

  it("caps the depth at 3 and draws deeper forks as siblings at that level", () => {
    const items = [chat("l0", 1), chat("l1", 2, "l0"), chat("l2", 3, "l1"), chat("l3", 4, "l2"), chat("l4", 5, "l3"), chat("l5", 6, "l4")];
    const rows = buildSidebarTree(items);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 3, 3, 3]);
    expect(rows.map((r) => r.isLastChild)).toEqual([true, true, true, false, false, true]);
  });

  it("keeps the top-level order of the input", () => {
    const items = [chat("c", 9), chat("a", 1), chat("b", 5, "a"), chat("d", 7)];
    expect(shape(items).map(([id]) => id)).toEqual(["c", "a", "b", "d"]);
  });

  it("returns every row as top-level in flat mode", () => {
    const items = [chat("f", 2, "p"), chat("p", 1)];
    expect(shape(items, true)).toEqual([
      ["f", 0, true],
      ["p", 0, true],
    ]);
  });
});
