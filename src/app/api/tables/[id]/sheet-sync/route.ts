import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/workflows/http";
import { ReconnectError, SyncError, syncTableToSheet } from "@/lib/google/sheets";

type Ctx = { params: Promise<{ id: string }> };

// A big table goes up in several writes.
export const maxDuration = 60;

/** "Sync now": overwrites this table's own Google sheet (created on the first sync). The body is ignored: the destination is not a parameter. */
export async function POST(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withUser(async (userId) => {
    try {
      return NextResponse.json(await syncTableToSheet(userId, id));
    } catch (e) {
      if (e instanceof ReconnectError) return NextResponse.json({ error: e.message, reconnect: true, connected: e.connected }, { status: 409 });
      // Only messages written for the user pass through; anything else is logged here and shown as a generic line.
      if (e instanceof SyncError) return NextResponse.json({ error: e.message }, { status: e.status });
      console.error("[sheet-sync]", e);
      return NextResponse.json({ error: "Couldn't sync to Google Sheets. Try again." }, { status: 502 });
    }
  });
}
