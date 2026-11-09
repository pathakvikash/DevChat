import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { cliProviderForModel } from "@/lib/cliProviders";
import { canUseHostTools, HOST_TOOLS_REFUSED } from "@/lib/hostAccess";
import { resolveModel } from "@/lib/llm";
import { getSettingsKey } from "@/lib/settings";
import { generateBody, generateFlow, GenerateError } from "@/lib/workflows/generate";
import { parseGraph, type WorkflowGraph } from "@/lib/workflows/graph";
import { withUser } from "@/lib/workflows/http";

/** One generation per user at a time (10.8). In memory: fine for one server process. */
const busy = new Set<string>();

/** A proposed flow for a description. It saves nothing: the editor previews it and applies it through PATCH. */
export async function POST(req: NextRequest) {
  return withUser(async (userId) => {
    const body = generateBody.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "Describe the flow you want." }, { status: 400 });
    if (busy.has(userId)) return NextResponse.json({ error: "A flow is already being generated. Wait for it to finish." }, { status: 409 });

    let current: WorkflowGraph | undefined;
    if (body.data.workflowId) {
      const row = await prisma.workflow.findFirst({ where: { id: body.data.workflowId, userId }, select: { graph: true } });
      if (!row) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
      try {
        current = parseGraph(row.graph);
      } catch {
        // a damaged graph is simply not offered as context
      }
    }
    const preferred = body.data.model || current?.defaultModel || (await getSettingsKey(userId, "defaultModel")) || "";
    const model = await resolveModel(preferred || undefined, userId);
    const cli = !!cliProviderForModel(model.id);
    if (cli && !(await canUseHostTools(userId))) return NextResponse.json({ error: HOST_TOOLS_REFUSED }, { status: 403 });

    busy.add(userId);
    try {
      const signal = AbortSignal.timeout(cli ? 180_000 : 120_000);
      const result = await generateFlow({
        description: body.data.description,
        model,
        current,
        defaultModel: current?.defaultModel || preferred || model.id,
        signal,
      });
      return NextResponse.json(result);
    } catch (e) {
      if (e instanceof GenerateError) return NextResponse.json({ error: e.message }, { status: 422 });
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
        return NextResponse.json({ error: "The model took too long. Try again or pick a faster model." }, { status: 504 });
      }
      throw e;
    } finally {
      busy.delete(userId);
    }
  });
}
