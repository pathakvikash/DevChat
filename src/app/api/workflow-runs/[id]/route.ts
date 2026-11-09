import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser } from "@/lib/workflows/http";
import { sweepOrphans } from "@/lib/workflows/runner";
import { parseGraph, type CardRun } from "@/lib/workflows/graph";

type Ctx = { params: Promise<{ id: string }> };

/** Run state and card runs without their outputs (poll this); `?node=<id>` returns one card run with its output. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withUser(async (userId) => {
    await sweepOrphans(userId);
    const run = await prisma.workflowRun.findFirst({ where: { id, userId } });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    const nodes = JSON.parse(run.nodes || "{}") as Record<string, CardRun>;
    const wanted = req.nextUrl.searchParams.get("node");
    if (wanted) {
      if (!nodes[wanted]) return NextResponse.json({ error: "That card has not run" }, { status: 404 });
      return NextResponse.json(nodes[wanted]);
    }
    return NextResponse.json({
      id: run.id,
      workflowId: run.workflowId,
      trigger: run.trigger,
      state: run.state,
      error: run.error,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      graph: parseGraph(run.graph),
      nodes: Object.fromEntries(Object.entries(nodes).map(([cardId, r]) => [cardId, { ...r, output: undefined }])),
    });
  });
}
