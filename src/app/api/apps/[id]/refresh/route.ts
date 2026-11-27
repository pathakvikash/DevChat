import { NextResponse } from "next/server";
import { refreshApp } from "@/lib/apps/registry";
import { withOwner } from "@/lib/apps/http";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withOwner(async ({ email }) => {
    const r = await refreshApp(id, email);
    return r ? NextResponse.json(r) : NextResponse.json({ error: "Not found" }, { status: 404 });
  });
}
