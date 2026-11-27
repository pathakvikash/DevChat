import { NextRequest, NextResponse } from "next/server";
import { previewApp } from "@/lib/apps/registry";
import { withOwner } from "@/lib/apps/http";

export async function POST(req: NextRequest) {
  return withOwner(async ({ email }) => {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.url !== "string") return NextResponse.json({ error: "url is required" }, { status: 400 });
    return NextResponse.json(await previewApp(body.url, email));
  });
}
