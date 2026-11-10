import { after, NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { estimateCost } from "@/lib/observability";
import { withUser } from "@/lib/workflows/http";
import { advanceRun, startRun, sweepOrphans } from "@/lib/workflows/runner";
import { parseGraph, type CardRun } from "@/lib/workflows/graph";

// The run keeps going in after(), so this is its time limit on a serverless host. Ignored by `next start`.
// A run cut off here becomes Interrupted (the heartbeat stops) and can be resumed.
// 300s is the most Vercel's Hobby plan accepts; Pro allows up to 800.
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };
const PAGE = 20;

/** Estimated USD for a run: each agent card's tokens at its model's price. Null when any model is unpriced. */
function runCost(graphJson: string, nodesJson: string, defaultModel: string): number | null {
  try {
    const graph = parseGraph(graphJson);
    const nodes = JSON.parse(nodesJson) as Record<string, CardRun>;
    let total = 0;
    for (const n of graph.nodes) {
      const u = nodes[n.id]?.usage;
      if (n.type !== "agent" || !u) continue;
      const cost = estimateCost(String(n.config.model || defaultModel || graph.defaultModel), u.inputTokens, u.outputTokens);
      if (cost === null) return null;
      total += cost;
    }
    return total;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withUser(async (userId) => {
    await sweepOrphans(userId);
    if (!(await prisma.workflow.findFirst({ where: { id, userId }, select: { id: true } }))) {
      return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
    }
    const cursor = req.nextUrl.searchParams.get("cursor");
    const rows = await prisma.workflowRun.findMany({
      where: { workflowId: id, userId },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: PAGE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, PAGE);
    return NextResponse.json({
      runs: page.map((r) => ({
        id: r.id,
        state: r.state,
        trigger: r.trigger,
        error: r.error,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        costUsd: runCost(r.graph, r.nodes, ""),
      })),
      next: rows.length > PAGE ? page[page.length - 1].id : null,
    });
  });
}

export async function POST(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withUser(async (userId) => {
    const r = await startRun(userId, id);
    if (!r.ok) return NextResponse.json({ error: r.error, ...(r.runId ? { runId: r.runId } : {}), ...(r.errors ? { errors: r.errors } : {}) }, { status: r.status });
    after(() => advanceRun(r.runId));
    return NextResponse.json({ runId: r.runId }, { status: 202 });
  });
}
