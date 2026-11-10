import { after, NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/workflows/http";
import { advanceRun, continueRun, resumeRun } from "@/lib/workflows/runner";

// Same limit as Start: the resumed run keeps going in after().
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/**
 * `{ nodeId, rowIds }`: continue a run that waits at a Pick rows card (6.4). No body: resume a failed or interrupted
 * run (6.5). Both belong to the signed-in user's own runs.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { nodeId?: unknown; rowIds?: unknown } | null;
  return withUser(async (userId) => {
    if (body && typeof body === "object" && "nodeId" in body && typeof body.nodeId !== "string") {
      return NextResponse.json({ error: "Send nodeId: the id of the waiting card." }, { status: 400 });
    }
    const r = body && typeof body.nodeId === "string" ? await continueRun(userId, id, body.nodeId, body.rowIds) : await resumeRun(userId, id);
    if (!r.ok) return NextResponse.json({ error: r.error, ...(r.runId ? { runId: r.runId } : {}) }, { status: r.status });
    after(() => advanceRun(r.runId));
    return NextResponse.json({ runId: r.runId }, { status: 202 });
  });
}
