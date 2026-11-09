import { describe, it, expect, vi, beforeEach } from "vitest";

// An in-memory DataTable / DataTableRow: just the calls writeRows and the table card make.
let table: any;
const lazy = <T,>(run: () => T) => ({ then: (ok: (v: T) => unknown, bad: (e: unknown) => unknown) => Promise.resolve().then(run).then(ok, bad) });
const rows = new Map<string, any>();
let seq = 0;
// What happens inside the next transactions: a hook that can add the rows another run saved at the same moment, then clash.
let clashHook: (() => void) | null = null;
let clashes = 0;
vi.mock("@/lib/db", () => ({
  prisma: {
    dataTable: {
      findFirst: vi.fn(async ({ where }: any) => (table && table.id === where.id && (where.userId === undefined || table.userId === where.userId) ? table : null)),
      update: vi.fn(async ({ data }: any) => Object.assign(table, data)),
    },
    dataTableRow: {
      findMany: vi.fn(async ({ where }: any) => [...rows.values()].filter((r) => r.tableId === where.tableId && where.key.in.includes(r.key))),
      count: vi.fn(async ({ where }: any) => [...rows.values()].filter((r) => r.tableId === where.tableId).length),
      // Like Prisma's, these promises are lazy: nothing is written until the transaction awaits them.
      create: vi.fn(({ data }: any) => lazy(() => {
        const row = { id: `row${++seq}`, ...data };
        rows.set(row.id, row);
        return row;
      })),
      update: vi.fn(({ where, data }: any) => lazy(() => Object.assign(rows.get(where.id), data))),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => {
      if (clashes > 0) {
        clashes--;
        clashHook?.();
        throw Object.assign(new Error("Unique constraint failed on the fields: (`tableId`,`key`)"), { code: "P2002" });
      }
      return Promise.all(ops);
    }),
  },
}));

import { loadTable, writeRows, MAX_TABLE_ROWS, MAX_WRITE_ROWS, type TableInfo } from "@/lib/workflows/tables";
import { tableCard } from "@/lib/workflows/cards/table";
import type { CardCtx } from "@/lib/workflows/cards";

const info = (): TableInfo => ({ id: "t1", name: "Jobs", columns: [], statuses: ["new"] });
const stored = (key: string) => [...rows.values()].find((r) => r.key === key);

beforeEach(() => {
  clashes = 0;
  clashHook = null;
  rows.clear();
  seq = 0;
  table = { id: "t1", userId: "u1", name: "Jobs", columns: "[]", statuses: '["new"]' };
});

describe("writeRows", () => {
  it("inserts new rows, then updates by key without resetting the status", async () => {
    const first = await writeRows(info(), "upsert", [{ key: "https://a.test/1", data: { title: "A" }, status: "new" }]);
    expect(first.inserted).toHaveLength(1);
    expect(first.inserted[0]).toMatchObject({ title: "A", status: "new" });
    rows.get(first.inserted[0]._rowId).status = "applied";

    const second = await writeRows(info(), "upsert", [
      { key: "https://a.test/1", data: { title: "A2", note: "x" }, status: "new" },
      { key: "https://a.test/2", data: { title: "B" }, status: "new" },
    ]);
    expect(second.inserted.map((r) => r.title)).toEqual(["B"]);
    expect(second.updated).toHaveLength(1);
    expect(second.updated[0]).toMatchObject({ title: "A2", note: "x", status: "applied" });
    expect(stored("https://a.test/1").status).toBe("applied");
    expect(JSON.parse(stored("https://a.test/1").data)).toEqual({ title: "A2", note: "x" });
  });

  it("gives the status to new rows only on upsert", async () => {
    await writeRows(info(), "upsert", [{ key: "k1", data: {}, status: "new" }]);
    const r = await writeRows(info(), "upsert", [
      { key: "k1", data: {}, status: "shortlist" },
      { key: "k2", data: {}, status: "shortlist" },
    ]);
    expect(stored("k1").status).toBe("new");
    expect(stored("k2").status).toBe("shortlist");
    expect(r.inserted[0].status).toBe("shortlist");
  });

  it("update touches the matched rows only, sets the status when given, and lists the keys it did not find", async () => {
    await writeRows(info(), "upsert", [{ key: "k1", data: { score: 1 }, status: "new" }]);
    const r = await writeRows(info(), "update", [
      { key: "k1", data: { score: 80 }, status: "shortlist" },
      { key: "gone", data: { score: 5 }, status: "shortlist" },
      { key: null, data: { score: 5 } },
    ]);
    expect(r.inserted).toEqual([]);
    expect(r.updated).toHaveLength(1);
    expect(r.missing).toEqual(["gone", "(no key)"]);
    expect(stored("k1").status).toBe("shortlist");
    expect(rows.size).toBe(1);
    // no status given: it stays
    await writeRows(info(), "update", [{ key: "k1", data: { score: 90 }, status: "" }]);
    expect(stored("k1").status).toBe("shortlist");
  });

  it("adds the columns and statuses the data brings, with guessed types", async () => {
    const r = await writeRows(info(), "upsert", [
      { key: "k1", data: { title: "T", link: "https://a.test/x", score: 7, body: "x".repeat(300) }, status: "shortlist" },
    ]);
    expect(r.addedColumns).toEqual(["title", "link", "score", "body"]);
    expect(JSON.parse(table.columns)).toEqual([
      { key: "title", label: "title", type: "text" },
      { key: "link", label: "link", type: "url" },
      { key: "score", label: "score", type: "number" },
      { key: "body", label: "body", type: "longtext" },
    ]);
    expect(JSON.parse(table.statuses)).toEqual(["new", "shortlist"]);
  });

  it("keeps the first of two items with the same key, and adds keyless rows every time", async () => {
    await writeRows(info(), "upsert", [
      { key: "k", data: { n: 1 }, status: "new" },
      { key: "k", data: { n: 2 }, status: "new" },
      { key: null, data: { n: 3 }, status: "new" },
    ]);
    await writeRows(info(), "upsert", [{ key: null, data: { n: 3 }, status: "new" }]);
    expect([...rows.values()].map((r) => JSON.parse(r.data).n)).toEqual([1, 3, 3]);
  });

  it("refuses a write over 1,000 rows and a table over 10,000", async () => {
    const many = Array.from({ length: MAX_WRITE_ROWS + 1 }, (_, i) => ({ key: `k${i}`, data: {}, status: "new" }));
    await expect(writeRows(info(), "upsert", many)).rejects.toThrow(/at most 1,000/);
    for (let i = 0; i < MAX_TABLE_ROWS - 1; i++) rows.set(`x${i}`, { id: `x${i}`, tableId: "t1", key: `x${i}`, status: "new", data: "{}" });
    await expect(writeRows(info(), "upsert", [{ key: "a", data: {}, status: "new" }, { key: "b", data: {}, status: "new" }])).rejects.toThrow(/10,000/);
    await expect(writeRows(info(), "upsert", [{ key: "a", data: {}, status: "new" }])).resolves.toBeTruthy();
  });
});

describe("two runs saving at once", () => {
  const other = () => rows.set("other1", { id: "other1", tableId: "t1", key: "k1", status: "new", data: JSON.stringify({ title: "from the other run" }) });

  it("reads again after a unique-key clash, so the clashing rows become updates", async () => {
    clashes = 1;
    clashHook = other; // the other run's row lands between our read and our write
    const r = await writeRows(info(), "upsert", [
      { key: "k1", data: { note: "mine" }, status: "new" },
      { key: "k2", data: { note: "mine" }, status: "new" },
    ]);
    expect(r.updated.map((x) => x._rowId)).toEqual(["other1"]);
    expect(r.inserted).toHaveLength(1);
    expect(JSON.parse(rows.get("other1").data)).toEqual({ title: "from the other run", note: "mine" });
    expect(rows.size).toBe(2);
  });

  it("says so in plain words when it clashes twice, without any database text", async () => {
    clashes = 2;
    const err = await writeRows(info(), "upsert", [{ key: "k1", data: {}, status: "new" }]).catch((e) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Another run is saving to “Jobs” at the same time. Run this one again.");
    expect((err as Error).message).not.toMatch(/Unique|P2002|prisma/i);
  });

  it("reloads the table before the second attempt, so columns another run added are kept", async () => {
    clashes = 1;
    clashHook = () => {
      other();
      table.columns = JSON.stringify([{ key: "extra", label: "extra", type: "text" }]); // another run added a column
    };
    await writeRows(info(), "upsert", [{ key: "k1", data: { note: "mine" }, status: "new" }]);
    expect(JSON.parse(table.columns).map((c: { key: string }) => c.key)).toEqual(["extra", "note"]);
  });

  it("does not retry any other error", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(new Error("disk full"));
    await expect(writeRows(info(), "upsert", [{ key: "k1", data: {}, status: "new" }])).rejects.toThrow("disk full");
  });
});

describe("loadTable", () => {
  it("is null for someone else's table", async () => {
    expect(await loadTable("u2", "t1")).toBeNull();
    expect((await loadTable("u1", "t1"))?.statuses).toEqual(["new"]);
  });
});

describe("the table card", () => {
  const ctx = (config: Record<string, unknown>, nodes: Record<string, unknown>): CardCtx =>
    ({
      userId: "u1",
      workflowId: "w1",
      node: { id: "save", type: "table", fromIds: [], config, ui: { label: "Save", position: { x: 0, y: 0 } } },
      config: { action: "upsert", keyField: "url", fields: [], status: "", ...config },
      tctx: { nodes, vars: {}, run: { id: "r", date: "2026-11-09", startedAt: "" }, workflow: { name: "W" } },
      defaultModel: "",
      signal: new AbortController().signal,
    }) as CardCtx;
  const news = { items: [{ title: "A", url: "https://News.test/a/?utm_source=x" }, { title: "B", url: "https://news.test/b" }] };

  it("saves every plain field, keys on the normalised url, and hands on the new rows", async () => {
    const first = await tableCard.run(ctx({ tableId: "t1", list: "{{news.items}}" }, { news }));
    const out = first.output as any;
    expect(out.inserted.map((r: any) => r.title)).toEqual(["A", "B"]);
    expect(out.items).toHaveLength(2);
    expect(stored("https://news.test/a")).toBeTruthy();
    const again = (await tableCard.run(ctx({ tableId: "t1", list: "{{news.items}}" }, { news }))).output as any;
    expect(again.inserted).toEqual([]);
    expect(again.updated).toHaveLength(2);
    expect(rows.size).toBe(2);
  });

  it("saves rows that came from a table without their row id or status as data", async () => {
    const fromRows = { items: [{ _rowId: "x", status: "new", url: "https://a.test/1", title: "T" }] };
    await tableCard.run(ctx({ tableId: "t1", list: "{{r.items}}" }, { r: fromRows }));
    expect(JSON.parse(stored("https://a.test/1").data)).toEqual({ url: "https://a.test/1", title: "T" });
  });

  it("maps columns with {{item}} and sets the status per item", async () => {
    const scored = { items: [{ url: "https://a.test/1", score: 80 }, { url: "https://a.test/2", score: 20 }] };
    await tableCard.run(ctx({ tableId: "t1", list: "{{s.items}}" }, { s: scored }));
    const r = (
      await tableCard.run(
        ctx({ tableId: "t1", action: "update", list: "{{s.items}}", fields: [{ column: "score", value: "{{item.score}}" }], status: "{{item.score}}" }, { s: scored }),
      )
    ).output as any;
    expect(r.updated.map((x: any) => x.score)).toEqual([80, 20]);
    expect(stored("https://a.test/1").status).toBe("80");
  });

  it("fails when the table is gone or the list is not a list", async () => {
    await expect(tableCard.run(ctx({ tableId: "nope", list: "{{news.items}}" }, { news }))).rejects.toThrow("Table not found");
    await expect(tableCard.run(ctx({ tableId: "t1", list: "{{news.title}}" }, { news }))).rejects.toThrow(/needs a list/);
  });
});
