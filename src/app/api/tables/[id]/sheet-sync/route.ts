import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/workflows/http";
import { ReconnectError, syncTableToSheet } from "@/lib/google/sheets";

type Ctx = { params: Promise<{ id: string }> };

/** "Sync now": overwrites this table's own Google sheet (created on the first sync). The body is ignored: the destination is not a parameter. */
export async function POST(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withUser(async (userId) => {
    try {
      return NextResponse.json(await syncTableToSheet(userId, id));
    } catch (e) {
      if (e instanceof ReconnectError) return NextResponse.json({ error: e.message, reconnect: true, connected: e.connected }, { status: 409 });
      if (e instanceof Error && e.message === "Table not found") return NextResponse.json({ error: e.message }, { status: 404 });
      console.error("[sheet-sync]", e);
      return NextResponse.json({ error: e instanceof Error ? e.message : "Something went wrong. Try again." }, { status: 502 });
    }
  });
}
