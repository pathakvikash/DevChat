import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { callAppTool, getApp } from "@/lib/apps/registry";
import { withUser } from "@/lib/apps/http";
import { orreryResultSchema } from "@/lib/apps/types";
import { jsonSchemaToZod } from "@/lib/chat/buildTools";
import { verifyRefreshSig } from "@/lib/apps/refreshSig";
import { isAppId } from "@/lib/generativeUi/appData";

const MIN_REFRESH_GAP_MS = 2000;
// ponytail: per-process map; a multi-instance deploy needs a shared store. Entries older than the gap are swept on each call.
const last = new Map<string, number>();

function tooSoon(key: string, now = Date.now()): number {
  for (const [k, t] of last) if (now - t >= MIN_REFRESH_GAP_MS) last.delete(k);
  const t = last.get(key);
  if (t !== undefined) return MIN_REFRESH_GAP_MS - (now - t);
  last.set(key, now);
  return 0;
}

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * Body `{ artifactId }`. The tool and args are NOT taken from the client: they are read from the data artifact Orrery
 * saved (chatTools.modelResult), i.e. from the `refresh` the app returned, and the app id from the `app` key Orrery added;
 * both are covered by the `sig` Orrery added (HMAC with AUTH_SECRET), which a model-written artifact cannot have.
 * The artifact must belong to the signed-in user, and the tool must be a read-only tool of that approved app.
 */
export async function POST(req: NextRequest) {
  return withUser(async ({ userId, email }) => {
    const body = (await req.json().catch(() => null)) as { artifactId?: unknown } | null;
    const artifactId = body?.artifactId;
    if (typeof artifactId !== "string" || !artifactId || artifactId.length > 100) return bad("Bad request");

    const artifact = await prisma.artifact.findUnique({ where: { id: artifactId }, include: { conversation: { select: { userId: true } } } });
    if (!artifact || artifact.conversation.userId !== userId) return bad("Not found", 404);

    let stored: Record<string, unknown> = {};
    try { stored = JSON.parse(artifact.content); } catch {}
    const original = orreryResultSchema.safeParse(stored);
    const appId = stored.app;
    if (!original.success || !isAppId(appId)) return bad("This result cannot refresh");
    const refresh = "refresh" in original.data ? original.data.refresh : undefined;
    if (!refresh) return bad("This result cannot refresh");
    // Only a result Orrery saved itself carries a valid signature; a model-written artifact has none (and no AUTH_SECRET means none can be checked).
    if (!verifyRefreshSig(artifact.id, appId, refresh, stored.sig)) return bad("This result cannot refresh");

    const app = await getApp(userId, appId);
    if (!app) return bad("Not found", 404);
    const spec = app.tools.find((t) => t.name === refresh.tool && t.readOnly === true);
    if (!spec) return bad("Not a read-only tool of this app");
    if (!jsonSchemaToZod(spec.inputSchema).safeParse(refresh.args ?? {}).success) return bad("The refresh arguments do not match the tool");

    const wait = tooSoon(`${userId}\0${artifactId}`);
    if (wait > 0) return NextResponse.json({ error: "Too many refreshes" }, { status: 429, headers: { "Retry-After": String(Math.ceil(wait / 1000)) } });

    const r = await callAppTool(userId, email, appId, refresh.tool, refresh.args ?? {}, { signal: req.signal });
    if (r.isError) return bad(r.text || "Refresh failed", 502);
    const next = orreryResultSchema.safeParse(r.structured);
    if (!next.success || next.data.type !== original.data.type) return bad("The app returned a different kind of result", 502);
    return NextResponse.json(next.data);
  });
}
