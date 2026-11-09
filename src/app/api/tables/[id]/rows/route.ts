import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withUser } from "@/lib/workflows/http";
import { loadTable, parseRowData } from "@/lib/workflows/tables";

type Ctx = { params: Promise<{ id: string }> };
const PAGE = 100;
const MAX_IDS = 1000;

/** SQLite's LIKE is already case-insensitive; Postgres needs `mode`, which only its client has (same rule as chatSearch). */
const contains = (q: string) => ({ contains: q, ...("QueryMode" in Prisma ? { mode: "insensitive" as const } : {}) });

const ids = (v: unknown): string[] | null =>
  Array.isArray(v) && v.length > 0 && v.length <= MAX_IDS && v.every((x) => typeof x === "string") ? (v as string[]) : null;

/** `?status=&q=&cursor=`: 100 rows, newest first. `nextCursor` is the id to pass for the next page. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withUser(async (userId) => {
    const table = await loadTable(userId, id);
    if (!table) return NextResponse.json({ error: "Table not found" }, { status: 404 });
    const url = req.nextUrl.searchParams;
    // `status` can repeat: pick mode shows every status a Pick rows card offers.
    const status = url.getAll("status").filter(Boolean);
    const q = url.get("q")?.trim();
    const cursor = url.get("cursor");
    const rows = await prisma.dataTableRow.findMany({
      where: { tableId: id, ...(status.length === 1 ? { status: status[0] } : status.length > 1 ? { status: { in: status } } : {}), ...(q ? { data: contains(q) } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      // The cursor row starts the page and is dropped here, not with `skip`: if it no longer matches the filter,
      // `skip: 1` would drop a real row instead.
      take: PAGE + 2,
      ...(cursor ? { cursor: { id: cursor } } : {}),
    });
    const after = cursor ? rows.filter((r) => r.id !== cursor) : rows;
    const more = after.length > PAGE;
    const page = after.slice(0, PAGE);
    return NextResponse.json({
      rows: page.map((r) => ({ id: r.id, key: r.key, status: r.status, data: parseRowData(r.data), createdAt: r.createdAt, updatedAt: r.updatedAt })),
      nextCursor: more ? page[page.length - 1].id : null,
    });
  });
}

/** `{ ids, status }`: set the status of those rows. The status must be one of the table's. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withUser(async (userId) => {
    const table = await loadTable(userId, id);
    if (!table) return NextResponse.json({ error: "Table not found" }, { status: 404 });
    const body = (await req.json().catch(() => null)) as { ids?: unknown; status?: unknown } | null;
    const list = ids(body?.ids);
    if (!list) return NextResponse.json({ error: `Send ids: 1 to ${MAX_IDS} row ids` }, { status: 400 });
    if (typeof body?.status !== "string" || !table.statuses.includes(body.status)) return NextResponse.json({ error: `Status must be one of: ${table.statuses.join(", ")}` }, { status: 400 });
    const r = await prisma.dataTableRow.updateMany({ where: { tableId: id, id: { in: list } }, data: { status: body.status } });
    return NextResponse.json({ updated: r.count });
  });
}

/** `{ ids }`: delete those rows. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withUser(async (userId) => {
    const table = await loadTable(userId, id);
    if (!table) return NextResponse.json({ error: "Table not found" }, { status: 404 });
    const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
    const list = ids(body?.ids);
    if (!list) return NextResponse.json({ error: `Send ids: 1 to ${MAX_IDS} row ids` }, { status: 400 });
    const r = await prisma.dataTableRow.deleteMany({ where: { tableId: id, id: { in: list } } });
    return NextResponse.json({ deleted: r.count });
  });
}
