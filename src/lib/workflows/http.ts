import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/lib/auth";

/** Runs a route body for the signed-in user. 401 when there is none; anything thrown becomes a plain 500. */
export async function withUser(body: (userId: string) => Promise<Response>): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch (e) {
    if (e instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    throw e;
  }
  try {
    return await body(userId);
  } catch (e) {
    console.error("[workflows]", e);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
