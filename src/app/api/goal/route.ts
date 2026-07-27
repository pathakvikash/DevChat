import { prisma } from "@/lib/db";
import { runGoal, type GoalEvent } from "@/lib/goal/orchestrator";

export const maxDuration = 800;

/** Stop a goal run. Sets a cancel flag the orchestrator polls each cycle, and
 *  optimistically marks the run "stopped" so the UI updates immediately even
 *  if the original streaming request is already gone (e.g. after a refresh). */
export async function PATCH(req: Request) {
  try {
    const { runId } = await req.json();
    if (!runId) {
      return new Response(JSON.stringify({ error: "runId required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const run = await prisma.goalRun.findUnique({ where: { id: runId } });
    if (!run) {
      return new Response(JSON.stringify({ error: "Goal run not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    const terminal = ["done", "failed"].includes(run.status);
    const updated = await prisma.goalRun.update({
      where: { id: runId },
      data: {
        cancelRequested: true,
        ...(terminal ? {} : { status: "stopped" }),
      },
    });
    return new Response(JSON.stringify({ run: updated }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Goal stop error:", error);
    return new Response(JSON.stringify({ error: "Failed to stop goal run" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/** Fetch the most recent goal run (with its checklist) for a conversation,
 *  so the panel can restore state on reload. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversationId");
  if (!conversationId) {
    return new Response(JSON.stringify({ error: "conversationId required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const run = await prisma.goalRun.findFirst({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    include: { tasks: { orderBy: { order: "asc" } } },
  });
  return new Response(JSON.stringify({ run }), {
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Start an autonomous Goal Mode run and stream progress as NDJSON
 * (one JSON event per line). The run plans a checklist, then works through it
 * across cycles until the objective is met, the budget runs out, or the client
 * disconnects (which aborts the run via req.signal).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      conversationId,
      objective,
      model,
      maxCycles,
      tokenBudget,
    }: {
      conversationId?: string;
      objective?: string;
      model?: string;
      maxCycles?: number;
      tokenBudget?: number;
    } = body;

    if (!conversationId || !objective || !objective.trim()) {
      return new Response(
        JSON.stringify({ error: "conversationId and objective are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, model: true },
    });
    if (!conv) {
      return new Response(JSON.stringify({ error: "Conversation not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const run = await prisma.goalRun.create({
      data: {
        conversationId,
        objective: objective.trim().slice(0, 4000),
        model: model || conv.model || "",
        maxCycles: clampInt(maxCycles, 1, 25, 10),
        tokenBudget: clampInt(tokenBudget, 10_000, 2_000_000, 120_000),
        status: "planning",
      },
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: GoalEvent & { runId?: string }) => {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        };
        send({ type: "status", status: "planning", cyclesUsed: 0, tokensUsed: 0, tokenBudget: run.tokenBudget, runId: run.id } as never);
        try {
          for await (const event of runGoal(run.id, req.signal)) {
            send(event);
          }
        } catch (e: any) {
          send({ type: "error", message: e?.message || String(e) });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Goal-Run-Id": run.id,
      },
    });
  } catch (error) {
    console.error("Goal API error:", error);
    return new Response(JSON.stringify({ error: "Failed to start goal run" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

function clampInt(
  v: number | undefined,
  lo: number,
  hi: number,
  fallback: number,
): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
