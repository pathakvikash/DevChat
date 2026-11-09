import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser } from "@/lib/workflows/http";
import { parseKinds } from "@/lib/workflows/privacy";
import { COLUMN_TYPES, toTableInfo, type Column } from "@/lib/workflows/tables";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withUser(async (userId) => {
    const row = await prisma.dataTable.findFirst({ where: { id, userId }, include: { _count: { select: { rows: true } } } });
    if (!row) return NextResponse.json({ error: "Table not found" }, { status: 404 });
    return NextResponse.json({ ...toTableInfo(row), private: row.privateFrom !== "", privateKinds: parseKinds(row.privateFrom), rowCount: row._count.rows, updatedAt: row.updatedAt });
  });
}

const isColumn = (c: unknown): c is Column => {
  const o = c as Partial<Column> | null;
  return !!o && typeof o.key === "string" && !!o.key && typeof o.label === "string" && COLUMN_TYPES.includes(o.type as Column["type"]);
};

/** Rename, columns or statuses. A column or status in use stays valid: rows keep what they hold. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withUser(async (userId) => {
    const body = (await req.json().catch(() => null)) as { name?: unknown; columns?: unknown; statuses?: unknown } | null;
    if (!body) return NextResponse.json({ error: "Send JSON" }, { status: 400 });
    const data: { name?: string; columns?: string; statuses?: string } = {};
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) return NextResponse.json({ error: "Name can't be empty" }, { status: 400 });
      data.name = body.name.trim().slice(0, 80);
      const same = await prisma.dataTable.findFirst({ where: { userId, name: data.name, id: { not: id } }, select: { id: true } });
      if (same) return NextResponse.json({ error: `You already have a table called “${data.name}”` }, { status: 409 });
    }
    if (body.columns !== undefined) {
      if (!Array.isArray(body.columns) || !body.columns.every(isColumn)) return NextResponse.json({ error: "Columns need a key, a label and a type" }, { status: 400 });
      data.columns = JSON.stringify(body.columns);
    }
    if (body.statuses !== undefined) {
      const ok = Array.isArray(body.statuses) && body.statuses.length > 0 && body.statuses.every((s) => typeof s === "string" && s.trim());
      if (!ok) return NextResponse.json({ error: "A table needs at least one status" }, { status: 400 });
      data.statuses = JSON.stringify((body.statuses as string[]).map((s) => s.trim()));
    }
    const r = await prisma.dataTable.updateMany({ where: { id, userId }, data });
    if (r.count === 0) return NextResponse.json({ error: "Table not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withUser(async (userId) => {
    const r = await prisma.dataTable.deleteMany({ where: { id, userId } });
    if (r.count === 0) return NextResponse.json({ error: "Table not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  });
}
