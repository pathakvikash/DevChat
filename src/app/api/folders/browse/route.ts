import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { browseFolder } from "@/lib/folders";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const q = req.nextUrl.searchParams;
    const r = await browseFolder(userId, q.get("path"), q.get("hidden") === "1");
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ path: r.path, parent: r.parent, dirs: r.dirs, truncated: r.truncated });
  } catch (error) {
    console.error("Failed to list folders:", error);
    return NextResponse.json({ error: "Failed to list folders" }, { status: 500 });
  }
}
