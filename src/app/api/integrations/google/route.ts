import { NextResponse } from "next/server";
import { withUser } from "@/lib/workflows/http";
import { connectionState, disconnect } from "@/lib/google/sheets";

/** Whether this user has connected Google for Sheets. Never returns a token. */
export async function GET() {
  return withUser(async (userId) => NextResponse.json(await connectionState(userId)));
}

/** Disconnect: deletes the stored tokens (and asks Google to revoke them). */
export async function DELETE() {
  return withUser(async (userId) => {
    await disconnect(userId);
    return NextResponse.json({ ok: true });
  });
}
