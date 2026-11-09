import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSettingsKey } from "@/lib/settings";
import { withUser } from "@/lib/workflows/http";
import { sweepOrphans } from "@/lib/workflows/runner";
import { buildTemplate, isTemplateKind } from "@/lib/workflows/templates";
import { parseGraph } from "@/lib/workflows/graph";

export async function GET() {
  return withUser(async (userId) => {
    await sweepOrphans(userId);
    const rows = await prisma.workflow.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } });
    const list = await Promise.all(
      rows.map(async (w) => {
        const last = await prisma.workflowRun.findFirst({
          where: { workflowId: w.id },
          orderBy: { startedAt: "desc" },
          select: { id: true, state: true, startedAt: true, endedAt: true },
        });
        let cardCount = 0;
        try {
          cardCount = parseGraph(w.graph).nodes.length;
        } catch {
          // a damaged graph still lists, with no count
        }
        return { id: w.id, name: w.name, updatedAt: w.updatedAt, cardCount, lastRun: last };
      }),
    );
    return NextResponse.json(list);
  });
}

export async function POST(req: NextRequest) {
  return withUser(async (userId) => {
    const body = (await req.json().catch(() => ({}))) as { name?: unknown; template?: unknown; model?: unknown };
    const defaultModel =
      (typeof body.model === "string" && body.model) || (await getSettingsKey(userId, "defaultModel")) || "";
    const { name, graph } = buildTemplate(isTemplateKind(body.template) ? body.template : "blank", defaultModel);
    const given = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    const row = await prisma.workflow.create({ data: { userId, name: given || name, graph: JSON.stringify(graph) } });
    return NextResponse.json({ id: row.id, name: row.name }, { status: 201 });
  });
}
