import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId, UnauthorizedError } from "@/lib/auth";
import { canUseHostTools } from "@/lib/hostAccess";
import { ManifestError } from "./manifest";

/** Runs a route body for the signed-in user (401 otherwise). Errors become plain JSON; manifest problems are the caller's 400. */
export async function withUser(body: (u: { userId: string; email: string }) => Promise<Response>): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch (e) {
    if (e instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    throw e;
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    return await body({ userId, email: user?.email ?? "" });
  } catch (e) {
    if (e instanceof ManifestError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[apps]", e);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}

/** Owner-only: OWNER_EMAILS decides (unset = everyone in development, no one in production). */
export function withOwner(body: (u: { userId: string; email: string }) => Promise<Response>): Promise<Response> {
  return withUser(async (u) => ((await canUseHostTools(u.userId)) ? body(u) : NextResponse.json({ error: "Only the server owner can manage apps." }, { status: 403 })));
}

export const idOk = (id: string) => /^[a-z0-9-]{2,32}$/.test(id);
