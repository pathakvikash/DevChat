import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isTransientProviderError } from "@/lib/chat/providerErrors";
import { cliProviderForModel } from "@/lib/cliProviders";
import { canUseHostTools, HOST_TOOLS_REFUSED } from "@/lib/hostAccess";
import { resolveModel } from "@/lib/llm";
import { getSettingsKey } from "@/lib/settings";
import { generateBody, generateFlow, GenerateError } from "@/lib/workflows/generate";
import { parseGraph, type WorkflowGraph } from "@/lib/workflows/graph";
import { withUser } from "@/lib/workflows/http";

// A CLI model may take up to 180 s, and the route adds a repair call's slack.
export const maxDuration = 200;

/** One generation per user at a time (10.8). In memory: fine for one server process. */
const busy = new Set<string>();

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/** A proposed flow for a description. It saves nothing: the editor previews it and applies it through PATCH. */
export async function POST(req: NextRequest) {
  return withUser(async (userId) => {
    const body = generateBody.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return fail("Describe the flow you want.", 400);
    if (busy.has(userId)) return fail("A flow is already being generated. Wait for it to finish.", 409);
    busy.add(userId);
    try {
      // resolveModel falls back to another model when the one asked for is not allowed, so a CLI model is refused first.
      if (body.data.model && cliProviderForModel(body.data.model) && !(await canUseHostTools(userId))) return fail(HOST_TOOLS_REFUSED, 403);

      let current: WorkflowGraph | undefined;
      if (body.data.workflowId) {
        const row = await prisma.workflow.findFirst({ where: { id: body.data.workflowId, userId }, select: { graph: true } });
        if (!row) return fail("Workflow not found", 404);
        try {
          current = parseGraph(row.graph);
        } catch {
          // a damaged graph is simply not offered as context
        }
      }
      const preferred = body.data.model || current?.defaultModel || (await getSettingsKey(userId, "defaultModel")) || "";
      const model = await resolveModel(preferred || undefined, userId);
      const cli = cliProviderForModel(model.id);
      if (cli && !(await canUseHostTools(userId))) return fail(HOST_TOOLS_REFUSED, 403);
      if (cli?.needsFolder) return fail(`${cli.label} needs a working folder, so it can't design flows. Pick another model.`, 422);

      const signal = AbortSignal.any([req.signal, AbortSignal.timeout(cli ? 180_000 : 120_000)]);
      try {
        const result = await generateFlow({ description: body.data.description, model, current, defaultModel: current?.defaultModel || model.id, signal, userId });
        return NextResponse.json(result);
      } catch (e) {
        if (e instanceof GenerateError) return fail(e.message, 422);
        // The client went away: nobody reads the answer.
        if (req.signal.aborted) return new NextResponse(null, { status: 499 });
        if (signal.aborted || (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"))) {
          return fail("The model took too long. Try again or pick a faster model.", 504);
        }
        const msg = e instanceof Error ? e.message : "";
        console.error("[workflows/generate]", e);
        return fail(isTransientProviderError(msg) ? "The model is busy or can't be reached right now. Try again in a moment." : "The model call failed. Check the model in Settings or pick another.", 502);
      }
    } finally {
      busy.delete(userId);
    }
  });
}
