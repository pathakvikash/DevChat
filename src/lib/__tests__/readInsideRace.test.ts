import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// After the file is opened, realpath of `target` answers `answer`, as if a parent directory had been swapped.
const swap = vi.hoisted(() => ({ opened: false, target: "", answer: "", statAfterOpen: false }));

vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      swap.opened = true;
      return handle;
    },
    // After the open, stat of `target` answers for a different file, as if the path had been swapped back.
    stat: async (...args: Parameters<typeof actual.stat>) => {
      const st = await actual.stat(...args);
      return swap.statAfterOpen && swap.opened && args[0] === swap.target ? Object.assign(Object.create(Object.getPrototypeOf(st)), st, { ino: Number(st.ino) + 1 }) : st;
    },
    realpath: async (...args: Parameters<typeof actual.realpath>) =>
      swap.opened && swap.answer && args[0] === swap.target ? swap.answer : actual.realpath(...args),
  };
});

import { readInside } from "@/lib/files/safePath";

let folder: string;
beforeAll(() => {
  folder = realpathSync(mkdtempSync(join(tmpdir(), "read-inside-")));
  writeFileSync(join(folder, "a.txt"), "hello");
});
afterAll(() => rmSync(folder, { recursive: true, force: true }));

describe("readInside re-checks the real path after the open", () => {
  it("reads normally when the path still resolves to the same file", async () => {
    swap.opened = false;
    swap.answer = "";
    expect(await readInside(folder, "a.txt")).toMatchObject({ ok: true, text: "hello" });
  });

  it("refuses when, after the open, the path leads to another file than the handle", async () => {
    swap.opened = false;
    swap.answer = "";
    swap.target = join(folder, "a.txt");
    swap.statAfterOpen = true;
    try {
      expect(await readInside(folder, "a.txt")).toEqual({ ok: false, reason: "missing" });
    } finally {
      swap.statAfterOpen = false;
    }
  });

  it("refuses when the path resolves elsewhere after the open", async () => {
    swap.opened = false;
    swap.target = join(folder, "a.txt");
    swap.answer = "/somewhere/else/a.txt";
    expect(await readInside(folder, "a.txt")).toEqual({ ok: false, reason: "refused" });
  });
});
