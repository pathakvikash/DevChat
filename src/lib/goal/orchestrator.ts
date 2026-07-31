import { generateText, stepCountIs } from "ai";
import { prisma } from "@/lib/db";
import { resolveModel } from "@/lib/llm";
import { extractJson } from "@/lib/utils/json";
import { buildTools, resolveActiveToolIds } from "@/lib/chat/buildTools";
import { consolidateMemory, getMemoryBlock } from "@/lib/memory";

export type GoalEvent =
  | { type: "plan"; tasks: { id: string; text: string }[]; objective: string }
  | { type: "cycle"; n: number; maxCycles: number; focus: string }
  | { type: "task"; id: string; status: string; note?: string }
  | { type: "thought"; cycle: number; text: string; toolNames: string[] }
  | { type: "status"; status: string; cyclesUsed: number; tokensUsed: number; tokenBudget: number }
  | { type: "done"; status: string; summary: string }
  | { type: "error"; message: string };

interface EvalResult {
  completedTaskIds?: string[];
  notes?: Record<string, string>;
  newTasks?: string[];
  goalComplete?: boolean;
  summary?: string;
}

const PLAN_SYSTEM = `You are an autonomous task planner. Given an OBJECTIVE, break it into a short, ordered checklist of concrete steps that an AI agent (which can search the web, execute Python/JavaScript, query a knowledge base, and remember facts) will work through.

Output ONLY a JSON array of 3-7 short step strings, e.g. ["Research X","Compare Y and Z","Write the summary"]. No prose, no numbering, no objects — just an array of strings. Keep each step concrete and verifiable.`;

const EVAL_SYSTEM = `You are the progress evaluator for an autonomous agent working through a checklist toward an OBJECTIVE. Given the checklist (with ids) and what the agent just did this cycle, decide what progressed.

Output ONLY a JSON object:
{
  "completedTaskIds": ["id1", ...],     // tasks now fully done (use the exact ids given)
  "notes": {"id1": "one-line result"},  // short finding per task, optional
  "newTasks": ["..."],                  // genuinely necessary new steps discovered, else []
  "goalComplete": true|false,           // true ONLY when the whole objective is satisfied
  "summary": "final deliverable / answer" // REQUIRED when goalComplete is true; the user-facing result
}
Be strict: only mark goalComplete when the objective is truly met. Prefer finishing over inventing busywork.`;

/** Run a goal to completion, yielding events as it progresses. Honors the
 *  abort signal (user pressed Stop / closed the stream). Never throws — emits
 *  an "error" event instead. */
export async function* runGoal(
  goalRunId: string,
  signal: AbortSignal,
  userId: string,
): AsyncGenerator<GoalEvent> {
  let run = await prisma.goalRun.findUnique({ where: { id: goalRunId } });
  if (!run) {
    yield { type: "error", message: "Goal run not found" };
    return;
  }

  const cfg = await resolveModel(run.model);
  const conv = await prisma.conversation.findUnique({
    where: { id: run.conversationId },
    select: { kbId: true },
  });
  const kbId = conv?.kbId ?? undefined;
  const activeToolIds = resolveActiveToolIds(
    kbId ? ["searchKnowledgeBase"] : [],
    [],
    kbId,
  );
  const tools = await buildTools({
    activeToolIds,
    searchProvider: "duckduckgo",
    conversationId: run.conversationId,
    userId,
  });

  let tokensUsed = 0;
  const addUsage = (result: { totalUsage?: any; usage?: any }) => {
    const u = result.totalUsage ?? result.usage ?? {};
    tokensUsed += (u.inputTokens ?? 0) + (u.outputTokens ?? 0);
  };

  try {
    // ---- PLAN ----
    await prisma.goalRun.update({ where: { id: goalRunId }, data: { status: "running" } });
    const planRes = await generateText({
      model: cfg.model,
      system: PLAN_SYSTEM,
      prompt: `OBJECTIVE:\n${run.objective}\n\nReturn the JSON array of steps.`,
      temperature: 0.3,
      abortSignal: signal,
    });
    addUsage(planRes);

    let steps = extractJson<string[]>(planRes.text, []);
    if (!Array.isArray(steps) || steps.length === 0) {
      steps = [`Work toward: ${run.objective}`, "Produce the final result"];
    }
    steps = steps.map((s) => String(s).trim()).filter(Boolean).slice(0, 8);

    const created = [];
    for (let i = 0; i < steps.length; i++) {
      created.push(
        await prisma.taskItem.create({
          data: { goalRunId, text: steps[i], order: i, status: "pending" },
        }),
      );
    }
    yield {
      type: "plan",
      objective: run.objective,
      tasks: created.map((t) => ({ id: t.id, text: t.text })),
    };

    const memBlock = await getMemoryBlock(userId);
    let cyclesUsed = 0;
    let staleCycles = 0;
    let finalStatus = "exhausted";
    let summary = "";

    // ---- CYCLES ----
    while (
      cyclesUsed < run.maxCycles &&
      tokensUsed < run.tokenBudget &&
      !signal.aborted
    ) {
      // Cooperative cancellation: a stop request (possibly from a different
      // client after a refresh) sets this flag; halt cleanly when we see it.
      const flag = await prisma.goalRun.findUnique({
        where: { id: goalRunId },
        select: { cancelRequested: true },
      });
      if (flag?.cancelRequested) {
        finalStatus = "stopped";
        break;
      }

      const tasks = await prisma.taskItem.findMany({
        where: { goalRunId },
        orderBy: { order: "asc" },
      });
      const remaining = tasks.filter((t) => t.status !== "done");
      if (remaining.length === 0) {
        finalStatus = "done";
        break;
      }

      const focus = remaining[0];
      cyclesUsed++;
      await prisma.taskItem.update({
        where: { id: focus.id },
        data: { status: "active" },
      });
      yield { type: "task", id: focus.id, status: "active" };
      yield { type: "cycle", n: cyclesUsed, maxCycles: run.maxCycles, focus: focus.text };

      const checklist = tasks
        .map((t) => `- [${t.status === "done" ? "x" : " "}] (${t.id}) ${t.text}${t.note ? ` — ${t.note}` : ""}`)
        .join("\n");

      const cycleSystem = `You are VAS in AUTONOMOUS GOAL MODE, working through a checklist toward an objective. You have REAL tools: webSearch, executeCode, searchKnowledgeBase (if a KB is attached), and memory tools. USE them — do not claim you cannot.

OBJECTIVE:
${run.objective}

CHECKLIST (current state):
${checklist}

THIS CYCLE, focus on: "${focus.text}"
- Take concrete action toward this step using your tools.
- Do the actual work now; don't ask the user — this is autonomous.
- End with a short report of what you accomplished and what you found.
${memBlock ? `\n${memBlock}` : ""}`;

      const cycleRes = await generateText({
        model: cfg.model,
        system: cycleSystem,
        prompt: `Work on the focused step now. Use tools as needed, then report what you did and learned.`,
        tools,
        toolChoice: "auto",
        temperature: 0.5,
        stopWhen: stepCountIs(6),
        abortSignal: signal,
      });
      addUsage(cycleRes);

      const toolNames = (cycleRes.steps ?? [])
        .flatMap((s: any) => (s.toolCalls ?? []).map((c: any) => c.toolName))
        .filter(Boolean);
      yield {
        type: "thought",
        cycle: cyclesUsed,
        text: cycleRes.text || "(worked silently)",
        toolNames,
      };

      if (signal.aborted) break;

      // ---- EVAL ----
      const freshTasks = await prisma.taskItem.findMany({
        where: { goalRunId },
        orderBy: { order: "asc" },
      });
      const evalChecklist = freshTasks
        .map((t) => `(${t.id}) [${t.status}] ${t.text}`)
        .join("\n");
      const evalRes = await generateText({
        model: cfg.model,
        system: EVAL_SYSTEM,
        prompt: `OBJECTIVE:\n${run.objective}\n\nCHECKLIST:\n${evalChecklist}\n\nWHAT THE AGENT DID THIS CYCLE (focused on "${focus.text}"):\n${cycleRes.text}\n\nReturn the JSON progress object.`,
        temperature: 0.1,
        abortSignal: signal,
      });
      addUsage(evalRes);
      const evaluation = extractJson<EvalResult>(evalRes.text, {});

      let madeProgress = false;
      const validIds = new Set(freshTasks.map((t) => t.id));
      const completed = (evaluation.completedTaskIds ?? []).filter((id) =>
        validIds.has(id),
      );
      // Safety net: if the model worked the focus step but didn't echo its id,
      // and reported no failure, count the focus step as done so we advance.
      if (completed.length === 0 && evaluation.goalComplete !== false) {
        completed.push(focus.id);
      }
      for (const id of completed) {
        const note = evaluation.notes?.[id];
        await prisma.taskItem.update({
          where: { id },
          data: { status: "done", note: note?.slice(0, 300) },
        });
        yield { type: "task", id, status: "done", note };
        madeProgress = true;
      }

      // Add newly discovered tasks (bounded).
      const newTasks = (evaluation.newTasks ?? [])
        .map((t) => String(t).trim())
        .filter(Boolean)
        .slice(0, 3);
      if (newTasks.length > 0 && freshTasks.length < 14) {
        let order = freshTasks.length;
        for (const text of newTasks) {
          const t = await prisma.taskItem.create({
            data: { goalRunId, text, order: order++, status: "pending" },
          });
          yield { type: "task", id: t.id, status: "pending", note: text };
        }
      }

      await prisma.goalRun.update({
        where: { id: goalRunId },
        data: { cyclesUsed, tokensUsed },
      });
      yield {
        type: "status",
        status: "running",
        cyclesUsed,
        tokensUsed,
        tokenBudget: run.tokenBudget,
      };

      if (evaluation.goalComplete) {
        finalStatus = "done";
        summary = evaluation.summary || cycleRes.text;
        break;
      }
      // No-progress detection: two consecutive cycles with nothing completed.
      staleCycles = madeProgress ? 0 : staleCycles + 1;
      if (staleCycles >= 2) {
        finalStatus = "exhausted";
        break;
      }
    }

    if (signal.aborted) finalStatus = "stopped";
    if (tokensUsed >= run.tokenBudget && finalStatus !== "done") finalStatus = "exhausted";

    // ---- FINALIZE ----
    if (!summary) {
      const done = await prisma.taskItem.findMany({
        where: { goalRunId, status: "done" },
        orderBy: { order: "asc" },
      });
      const finalRes = await generateText({
        model: cfg.model,
        system: `You are VAS. Write the final deliverable for an autonomous goal run: a clear, self-contained answer to the objective based on the work completed. Be direct and useful.`,
        prompt: `OBJECTIVE:\n${run.objective}\n\nCOMPLETED STEPS AND FINDINGS:\n${done.map((t) => `- ${t.text}${t.note ? `: ${t.note}` : ""}`).join("\n") || "(little was completed)"}\n\nWrite the final result for the user now.`,
        temperature: 0.4,
        abortSignal: signal,
      }).catch(() => null);
      if (finalRes) {
        addUsage(finalRes);
        summary = finalRes.text;
      }
    }
    summary = summary || "Goal run ended without a final summary.";

    await prisma.goalRun.update({
      where: { id: goalRunId },
      data: { status: finalStatus, summary, cyclesUsed, tokensUsed },
    });

    // Persist the deliverable as an assistant message so it shows in the chat.
    await prisma.message.create({
      data: {
        conversationId: run.conversationId,
        role: "assistant",
        content: summary,
        parts: JSON.stringify([
          { type: "text", text: `**Goal ${finalStatus === "done" ? "completed" : finalStatus}:** ${run.objective}\n\n${summary}` },
        ]),
        model: cfg.id,
      },
    });

    yield {
      type: "status",
      status: finalStatus,
      cyclesUsed,
      tokensUsed,
      tokenBudget: run.tokenBudget,
    };
    yield { type: "done", status: finalStatus, summary };

    // Learn from the run: consolidate long-term memory (fire-and-forget).
    consolidateMemory({ conversationId: run.conversationId, userId, modelId: run.model }).catch(
      () => {},
    );
  } catch (e: any) {
    const aborted = signal.aborted || e?.name === "AbortError";
    const status = aborted ? "stopped" : "failed";
    await prisma.goalRun
      .update({ where: { id: goalRunId }, data: { status } })
      .catch(() => {});
    if (aborted) {
      yield { type: "status", status, cyclesUsed: 0, tokensUsed, tokenBudget: run.tokenBudget };
      yield { type: "done", status, summary: "Run stopped." };
    } else {
      yield { type: "error", message: e?.message || String(e) };
    }
  }
}
