import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSettingsKey } from "@/lib/settings";
import { hostToolsReason } from "@/lib/hostAccess";
import { withUser } from "@/lib/workflows/http";
import { sweepOrphans } from "@/lib/workflows/runner";
import { buildTemplate, isTemplateKind } from "@/lib/workflows/templates";
import { parseGraph } from "@/lib/workflows/graph";
import { JOB_COLUMNS, JOB_STATUSES, NEWS_COLUMNS, NEWS_STATUSES } from "@/lib/workflows/tables";

const newsTable = (userId: string) =>
  prisma.dataTable.upsert({
    where: { userId_name: { userId, name: "News" } },
    update: {},
    create: { userId, name: "News", columns: JSON.stringify(NEWS_COLUMNS), statuses: JSON.stringify(NEWS_STATUSES) },
    select: { id: true },
  });

const jobsTable = (userId: string) =>
  prisma.dataTable.upsert({
    where: { userId_name: { userId, name: "Job leads" } },
    update: {},
    create: { userId, name: "Job leads", columns: JSON.stringify(JOB_COLUMNS), statuses: JSON.stringify(JOB_STATUSES) },
    select: { id: true },
  });

export async function GET() {
  return withUser(async (userId) => {
    await sweepOrphans(userId);
    const rows = await prisma.workflow.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } });
    const newest = await prisma.workflowRun.groupBy({ by: ["workflowId"], where: { workflowId: { in: rows.map((w) => w.id) } }, _max: { startedAt: true } });
    const startedAts = newest.flatMap((g) => (g._max.startedAt ? [g._max.startedAt] : []));
    const runs = startedAts.length
      ? await prisma.workflowRun.findMany({
          where: { workflowId: { in: rows.map((w) => w.id) }, startedAt: { in: startedAts } },
          orderBy: { startedAt: "desc" },
          select: { id: true, workflowId: true, state: true, startedAt: true, endedAt: true },
        })
      : [];
    const lastRun = new Map<string, { id: string; state: string; startedAt: Date; endedAt: Date | null }>();
    for (const { workflowId, ...run } of runs) if (!lastRun.has(workflowId)) lastRun.set(workflowId, run);
    const list = rows.map((w) => {
      let cardCount = 0;
      try {
        cardCount = parseGraph(w.graph).nodes.length;
      } catch {
        // a damaged graph still lists, with no count
      }
      return { id: w.id, name: w.name, updatedAt: w.updatedAt, cardCount, lastRun: lastRun.get(w.id) ?? null };
    });
    return NextResponse.json(list);
  });
}

export async function POST(req: NextRequest) {
  return withUser(async (userId) => {
    const body = (await req.json().catch(() => ({}))) as { name?: unknown; template?: unknown; model?: unknown };
    const defaultModel =
      (typeof body.model === "string" && body.model) || (await getSettingsKey(userId, "defaultModel")) || "";
    const kind = isTemplateKind(body.template) ? body.template : "blank";
    if (kind === "explain-folder") {
      const why = await hostToolsReason(userId);
      if (why) return NextResponse.json({ error: why }, { status: 403 });
    }
    // The News template saves into the user's "News" table, which is made here the first time.
    // The Jobs template saves into "Job leads", made the same way.
    const table = kind === "news" ? await newsTable(userId) : kind === "jobs" ? await jobsTable(userId) : null;
    const { name, graph } = buildTemplate(kind, defaultModel, table?.id);
    const given = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    const row = await prisma.workflow.create({ data: { userId, name: given || name, graph: JSON.stringify(graph) } });
    return NextResponse.json({ id: row.id, name: row.name }, { status: 201 });
  });
}
