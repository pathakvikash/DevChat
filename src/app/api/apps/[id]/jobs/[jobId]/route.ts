import { NextRequest, NextResponse } from "next/server";
import { callAppTool, getApp } from "@/lib/apps/registry";
import { withUser } from "@/lib/apps/http";

/** `?tool=<statusTool>` comes from the job result; it must be a read-only tool of the app. `X-Orrery-Job: 1` is required so a plain cross-site link cannot trigger it. Called with `{ jobId }`. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; jobId: string }> }) {
  const { id, jobId } = await ctx.params;
  return withUser(async ({ userId, email }) => {
    if (req.headers.get("x-orrery-job") !== "1") return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const app = await getApp(userId, id);
    if (!app) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const tool = req.nextUrl.searchParams.get("tool") ?? "";
    if (!app.tools.some((t) => t.name === tool && t.readOnly === true)) return NextResponse.json({ error: "Not a read-only tool of this app" }, { status: 400 });
    if (jobId.length > 200) return NextResponse.json({ error: "Bad job id" }, { status: 400 });
    const r = await callAppTool(userId, email, id, tool, { jobId }, { signal: req.signal, job: true });
    if (r.isError) return NextResponse.json({ error: r.text || "Status check failed" }, { status: 502 });
    if (!r.job) return NextResponse.json({ error: "The app returned an unreadable job status" }, { status: 502 });
    return NextResponse.json(r.job);
  });
}
