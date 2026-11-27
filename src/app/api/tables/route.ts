import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser } from "@/lib/workflows/http";
import { DEFAULT_STATUS } from "@/lib/workflows/tables";
import { parseKinds } from "@/lib/workflows/privacy";

const MAX_NAME = 80;

export async function GET() {
  return withUser(async (userId) => {
    const rows = await prisma.dataTable.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, privateFrom: true, updatedAt: true, _count: { select: { rows: true } } },
    });
    // A table's own updatedAt only moves when its columns do, so the newest row counts too.
    const newest = await prisma.dataTableRow.groupBy({ by: ["tableId"], where: { tableId: { in: rows.map((t) => t.id) } }, _max: { updatedAt: true } });
    const lastRow = new Map(newest.map((g) => [g.tableId, g._max.updatedAt]));
    const list = rows.map((t) => {
      const last = lastRow.get(t.id);
      const updatedAt = last && last > t.updatedAt ? last : t.updatedAt;
      return { id: t.id, name: t.name, private: parseKinds(t.privateFrom).length > 0, privateKinds: parseKinds(t.privateFrom), rowCount: t._count.rows, updatedAt };
    });
    list.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return NextResponse.json(list);
  });
}

export async function POST(req: NextRequest) {
  return withUser(async (userId) => {
    const body = (await req.json().catch(() => ({}))) as { name?: unknown; statuses?: unknown };
    const name = typeof body.name === "string" ? body.name.trim().slice(0, MAX_NAME) : "";
    if (!name) return NextResponse.json({ error: "Give the table a name" }, { status: 400 });
    const statuses = Array.isArray(body.statuses) ? body.statuses.filter((s): s is string => typeof s === "string" && !!s.trim()).map((s) => s.trim()) : [];
    if (await prisma.dataTable.findFirst({ where: { userId, name }, select: { id: true } })) {
      return NextResponse.json({ error: `You already have a table called “${name}”` }, { status: 409 });
    }
    const row = await prisma.dataTable.create({ data: { userId, name, statuses: JSON.stringify(statuses.length ? statuses : [DEFAULT_STATUS]) } });
    return NextResponse.json({ id: row.id, name: row.name }, { status: 201 });
  });
}
