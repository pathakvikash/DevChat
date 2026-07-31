import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);

    const [total, recent, byModel, byStatus] = await Promise.all([
      prisma.trace.count({ where: { userId } }),
      prisma.trace.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: limit,
        include: { toolCalls: { orderBy: { createdAt: "asc" } } },
      }),
      prisma.trace.groupBy({
        where: { userId },
        by: ["model"],
        _count: { _all: true },
        _sum: { promptTokens: true, completionTokens: true, totalTokens: true, cost: true, latencyMs: true },
        _avg: { latencyMs: true, firstTokenMs: true, totalTokens: true, cost: true },
      }),
      prisma.trace.groupBy({
        where: { userId },
        by: ["status"],
        _count: { _all: true },
      }),
    ]);

    // Roll totals across all traces (not just the page) for the header cards.
    const agg = await prisma.trace.aggregate({
      where: { userId },
      _sum: {
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        cost: true,
        latencyMs: true,
      },
      _avg: {
        latencyMs: true,
        firstTokenMs: true,
        totalTokens: true,
        cost: true,
      },
      _count: { _all: true },
    });

    const statusCounts = Object.fromEntries(
      (byStatus as { status: string; _count: { _all: number } }[]).map((s) => [s.status, s._count._all]),
    );

    return NextResponse.json({
      total,
      summary: {
        requests: agg._count._all,
        promptTokens: agg._sum.promptTokens ?? 0,
        completionTokens: agg._sum.completionTokens ?? 0,
        totalTokens: agg._sum.totalTokens ?? 0,
        cost: agg._sum.cost ?? null,
        avgLatencyMs: agg._avg.latencyMs ?? null,
        avgFirstTokenMs: agg._avg.firstTokenMs ?? null,
        avgTotalTokens: agg._avg.totalTokens ?? null,
        avgCost: agg._avg.cost ?? null,
        statusCounts,
      },
      byModel: (byModel as any[]).map((m) => ({
        model: m.model,
        requests: m._count._all,
        promptTokens: m._sum.promptTokens ?? 0,
        completionTokens: m._sum.completionTokens ?? 0,
        totalTokens: m._sum.totalTokens ?? 0,
        cost: m._sum.cost ?? null,
        avgLatencyMs: m._avg.latencyMs ?? null,
        avgTotalTokens: m._avg.totalTokens ?? null,
        avgCost: m._avg.cost ?? null,
      })),
      traces: recent.map((t) => ({
        id: t.id,
        conversationId: t.conversationId,
        model: t.model,
        provider: t.provider,
        promptTokens: t.promptTokens,
        completionTokens: t.completionTokens,
        totalTokens: t.totalTokens,
        cost: t.cost,
        latencyMs: t.latencyMs,
        firstTokenMs: t.firstTokenMs,
        steps: t.steps,
        finishReason: t.finishReason,
        status: t.status,
        errorMsg: t.errorMsg,
        inputChars: t.inputChars,
        outputChars: t.outputChars,
        createdAt: t.createdAt,
        toolCalls: (t.toolCalls as any[]).map((tc) => ({
          id: tc.id,
          toolName: tc.toolName,
          input: tc.input,
          output: tc.output,
          ok: tc.ok,
          latencyMs: tc.latencyMs,
        })),
      })),
    });
  } catch (e) {
    console.error("[observability] GET failed:", e);
    return NextResponse.json({ error: "Failed to load observability data" }, { status: 500 });
  }
}
