import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { listProjects, listSessions } from "@/lib/claude/sessions";

export const runtime = "nodejs";

/** Projects that can host a run, plus recent sessions for the browser. */
export async function GET(req: Request) {
  await requireUserId();
  const url = new URL(req.url);
  const projectSlug = url.searchParams.get("project") || undefined;
  const limitParam = parseInt(url.searchParams.get("limit") || "", 10);
  const limit = Number.isFinite(limitParam)
    ? Math.max(1, Math.min(200, limitParam))
    : 40;

  try {
    const [projects, sessions] = await Promise.all([
      listProjects(),
      listSessions({ projectSlug, limit }),
    ]);
    return NextResponse.json({ projects, sessions });
  } catch (error) {
    console.error("Failed to list Claude sessions:", error);
    return NextResponse.json({ error: "Failed to list Claude sessions" }, { status: 500 });
  }
}
