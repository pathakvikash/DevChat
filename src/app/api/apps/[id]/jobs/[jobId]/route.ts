import { NextRequest, NextResponse } from "next/server";
import { callAppTool, getApp } from "@/lib/apps/registry";
import { withUser } from "@/lib/apps/http";

/** `?tool=<statusTool>` comes from the job result; it must be one of the app's own tools. The tool is called with `{ jobId }`. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; jobId: string }> }) {
  const { id, jobId } = await ctx.params;
  return withUser(async ({ userId, email }) => {
    const app = await getApp(userId, id);
    const tool = req.nextUrl.searchParams.get("tool") ?? "";
    if (!app || !app.tools.some((t) => t.name === tool)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (jobId.length > 200) return NextResponse.json({ error: "Bad job id" }, { status: 400 });
    const r = await callAppTool(userId, email, id, tool, { jobId }, { signal: req.signal, job: true });
    if (r.isError) return NextResponse.json({ error: r.text || "Status check failed" }, { status: 502 });
    if (!r.job) return NextResponse.json({ error: "The app returned an unreadable job status" }, { status: 502 });
    return NextResponse.json(r.job);
  });
}
