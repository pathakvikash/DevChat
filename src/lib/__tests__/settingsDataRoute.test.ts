import { describe, it, expect, vi, beforeEach } from "vitest";

const { MODELS, rows, dropParkedRuns, disconnectFromServer } = vi.hoisted(() => ({
  dropParkedRuns: vi.fn(),
  disconnectFromServer: vi.fn().mockResolvedValue(undefined),
  MODELS: ["workflowRun", "workflow", "dataTable", "trace", "conversation", "memory", "knowledgeBase", "persona", "mcpServer"],
  // Two users' rows per model; deleteMany honours the where filter like the real thing.
  rows: {} as Record<string, Array<{ userId: string }>>,
}));
vi.mock("@/lib/db", () => {
  const prisma: any = { $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)) };
  for (const m of MODELS) {
    prisma[m] = {
      findMany: vi.fn(async ({ where }: { where: { userId: string } }) =>
        rows[m].filter((r) => r.userId === where.userId).map((_, i) => ({ id: `${m}-${i}` })),
      ),
      deleteMany: vi.fn(async ({ where }: { where: { userId: string } }) => {
        rows[m] = rows[m].filter((r) => r.userId !== where.userId);
      }),
    };
  }
  prisma.user = { delete: vi.fn() };
  prisma.account = { deleteMany: vi.fn() };
  prisma.appSetting = { deleteMany: vi.fn() };
  return { prisma };
});
vi.mock("@/lib/cliProviders", () => ({ dropParkedRuns }));
vi.mock("@/lib/mcp/client", () => ({ disconnectFromServer }));
vi.mock("@/lib/auth", () => ({
  requireUserId: vi.fn().mockResolvedValue("u1"),
  UnauthorizedError: class extends Error {},
}));

import { prisma } from "@/lib/db";
import { DELETE } from "@/app/api/settings/data/route";

const db = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  for (const m of MODELS) rows[m] = [{ userId: "u1" }, { userId: "u1" }, { userId: "u2" }];
});

describe("DELETE /api/settings/data", () => {
  it("empties every user-owned model for the caller only, in one transaction", async () => {
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    for (const m of MODELS) expect(rows[m]).toEqual([{ userId: "u2" }]);
  });

  it("releases parked CLI runs and MCP connections before deleting", async () => {
    await DELETE();
    expect(dropParkedRuns.mock.calls.map((c) => c[0])).toEqual(["conversation-0", "conversation-1"]);
    expect(disconnectFromServer.mock.calls.map((c) => c[0])).toEqual(["mcpServer-0", "mcpServer-1"]);
    expect(dropParkedRuns.mock.invocationCallOrder[0]).toBeLessThan(db.$transaction.mock.invocationCallOrder[0]);
  });

  it("leaves the account, sign-in and settings alone", async () => {
    await DELETE();
    expect(db.user.delete).not.toHaveBeenCalled();
    expect(db.account.deleteMany).not.toHaveBeenCalled();
    expect(db.appSetting.deleteMany).not.toHaveBeenCalled();
  });
});
