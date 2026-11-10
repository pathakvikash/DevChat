import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser } from "@/lib/workflows/http";
import { loadTable, parseRowData, toCsv } from "@/lib/workflows/tables";

type Ctx = { params: Promise<{ id: string }> };

/** The whole table as CSV, oldest row first. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withUser(async (userId) => {
    const table = await loadTable(userId, id);
    if (!table) return NextResponse.json({ error: "Table not found" }, { status: 404 });
    const rows = await prisma.dataTableRow.findMany({ where: { tableId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const csv = toCsv(table.columns, rows.map((r) => ({ status: r.status, data: parseRowData(r.data) })));
    const file = `${table.name.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "table"}.csv`;
    return new Response(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file}"`, "Cache-Control": "no-store" },
    });
  });
}
