import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser } from "@/lib/workflows/http";
import { checkGraph, parseGraph, validateStructure, type CardRun } from "@/lib/workflows/graph";

type Ctx = { params: Promise<{ id: string }> };
const MAX_GRAPH_CHARS = 1_000_000;

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withUser(async (userId) => {
    const w = await prisma.workflow.findFirst({ where: { id, userId } });
    if (!w) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
    let graph;
    try {
      graph = parseGraph(w.graph);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid graph" }, { status: 500 });
    }
    const last = await prisma.workflowRun.findFirst({ where: { workflowId: id }, orderBy: { startedAt: "desc" } });
    const statuses: Record<string, string> = {};
    if (last) for (const [cardId, r] of Object.entries(JSON.parse(last.nodes || "{}") as Record<string, CardRun>)) statuses[cardId] = r.status;
    return NextResponse.json({
      id: w.id,
      name: w.name,
      updatedAt: w.updatedAt,
      graph,
      latestRun: last ? { id: last.id, state: last.state, statuses } : null,
      warnings: checkGraph(graph),
    });
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withUser(async (userId) => {
    const body = (await req.json().catch(() => null)) as { name?: unknown; graph?: unknown } | null;
    if (!body) return NextResponse.json({ error: "Send JSON" }, { status: 400 });
    const data: { name?: string; graph?: string } = {};
    let warnings: ReturnType<typeof checkGraph> = [];
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) return NextResponse.json({ error: "Name can't be empty" }, { status: 400 });
      data.name = body.name.trim().slice(0, 120);
    }
    if (body.graph !== undefined) {
      let graph;
      try {
        graph = parseGraph(body.graph);
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid graph" }, { status: 400 });
      }
      const errors = validateStructure(graph);
      if (errors.length > 0) return NextResponse.json({ error: errors[0], errors }, { status: 400 });
      data.graph = JSON.stringify(graph);
      if (data.graph.length > MAX_GRAPH_CHARS) return NextResponse.json({ error: "This workflow is too large" }, { status: 400 });
      warnings = checkGraph(graph);
    }
    const r = await prisma.workflow.updateMany({ where: { id, userId }, data });
    if (r.count === 0) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
    return NextResponse.json({ ok: true, warnings });
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withUser(async (userId) => {
    const r = await prisma.workflow.deleteMany({ where: { id, userId } });
    if (r.count === 0) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  });
}
