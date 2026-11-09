import { after, NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/workflows/http";
import { advanceRun, resumeRun } from "@/lib/workflows/runner";

// Same limit as Start: the resumed run keeps going in after().
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/** No body: resume a failed or interrupted run (6.5). The `{ nodeId, rowIds }` form that continues a waiting run comes with Pick rows. */
export async function POST(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withUser(async (userId) => {
    const r = await resumeRun(userId, id);
    if (!r.ok) return NextResponse.json({ error: r.error, ...(r.runId ? { runId: r.runId } : {}) }, { status: r.status });
    after(() => advanceRun(r.runId));
    return NextResponse.json({ runId: r.runId }, { status: 202 });
  });
}
