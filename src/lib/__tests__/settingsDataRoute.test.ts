import { describe, it, expect, vi, beforeEach } from "vitest";

const MODELS = ["workflowRun", "workflow", "dataTable", "trace", "conversation", "memory", "knowledgeBase", "persona", "mcpServer"];
// Two users' rows per model; deleteMany honours the where filter like the real thing.
const rows: Record<string, Array<{ userId: string }>> = {};
vi.mock("@/lib/db", () => {
  const prisma: any = { $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)) };
  for (const m of MODELS) {
    prisma[m] = {
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
vi.mock("@/lib/auth", () => ({
  requireUserId: vi.fn().mockResolvedValue("u1"),
  UnauthorizedError: class extends Error {},
}));

import { prisma } from "@/lib/db";
import { DELETE } from "@/app/api/settings/data/route";

const db = prisma as any;

beforeEach(() => {
  for (const m of MODELS) rows[m] = [{ userId: "u1" }, { userId: "u1" }, { userId: "u2" }];
});

describe("DELETE /api/settings/data", () => {
  it("empties every user-owned model for the caller only, in one transaction", async () => {
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    for (const m of MODELS) expect(rows[m]).toEqual([{ userId: "u2" }]);
  });

  it("leaves the account, sign-in and settings alone", async () => {
    await DELETE();
    expect(db.user.delete).not.toHaveBeenCalled();
    expect(db.account.deleteMany).not.toHaveBeenCalled();
    expect(db.appSetting.deleteMany).not.toHaveBeenCalled();
  });
});
