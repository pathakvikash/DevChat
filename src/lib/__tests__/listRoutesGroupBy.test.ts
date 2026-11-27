import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    dataTable: { findMany: vi.fn() },
    dataTableRow: { groupBy: vi.fn(), findFirst: vi.fn() },
    workflow: { findMany: vi.fn() },
    workflowRun: { groupBy: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn().mockResolvedValue("u1"), UnauthorizedError: class extends Error {} }));
vi.mock("@/lib/workflows/runner", () => ({ sweepOrphans: vi.fn() }));

import { prisma } from "@/lib/db";
import { GET as tables } from "@/app/api/tables/route";
import { GET as workflows } from "@/app/api/workflows/route";

const db = prisma as any;
const d = (n: number) => new Date(n);

describe("list routes make a fixed number of queries", () => {
  it("GET /api/tables uses the newest row's time when it is later than the table's", async () => {
    db.dataTable.findMany.mockResolvedValue([
      { id: "t1", name: "A", privateFrom: "[]", updatedAt: d(100), _count: { rows: 2 } },
      { id: "t2", name: "B", privateFrom: "[]", updatedAt: d(300), _count: { rows: 0 } },
    ]);
    db.dataTableRow.groupBy.mockResolvedValue([{ tableId: "t1", _max: { updatedAt: d(200) } }]);
    const body = await (await tables()).json();
    expect(body.map((t: any) => [t.id, t.updatedAt, t.rowCount])).toEqual([["t2", d(300).toISOString(), 0], ["t1", d(200).toISOString(), 2]]);
    expect(db.dataTableRow.findFirst).not.toHaveBeenCalled();
  });

  it("GET /api/workflows attaches each workflow's latest run, or null", async () => {
    db.workflow.findMany.mockResolvedValue([
      { id: "w1", name: "A", graph: "not json", updatedAt: d(1) },
      { id: "w2", name: "B", graph: "not json", updatedAt: d(2) },
    ]);
    db.workflowRun.groupBy.mockResolvedValue([{ workflowId: "w1", _max: { startedAt: d(50) } }]);
    db.workflowRun.findMany.mockResolvedValue([{ id: "r1", workflowId: "w1", state: "succeeded", startedAt: d(50), endedAt: d(60) }]);
    const body = await (await workflows()).json();
    expect(body[0].lastRun).toEqual({ id: "r1", state: "succeeded", startedAt: d(50).toISOString(), endedAt: d(60).toISOString() });
    expect(body[1].lastRun).toBeNull();
    expect(db.workflowRun.findFirst).not.toHaveBeenCalled();
  });
});
