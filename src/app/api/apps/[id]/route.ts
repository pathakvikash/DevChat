import { NextResponse } from "next/server";
import { removeApp } from "@/lib/apps/registry";
import { withOwner } from "@/lib/apps/http";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withOwner(async () => ((await removeApp(id)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 })));
}
