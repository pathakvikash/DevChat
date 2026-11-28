import { NextRequest, NextResponse } from "next/server";
import { canUseHostTools } from "@/lib/hostAccess";
import { listApps, registerApp } from "@/lib/apps/registry";
import { withOwner, withUser } from "@/lib/apps/http";

export async function GET(req: NextRequest) {
  return withUser(async ({ userId }) => {
    const owner = await canUseHostTools(userId);
    // `all=1` (Settings > Apps) adds apps waiting for approval, for the owner only; everyone else gets approved apps.
    const includeUnapproved = owner && req.nextUrl.searchParams.get("all") === "1";
    const apps = await listApps(userId, { includeUnapproved });
    const rows = apps.map((a) => ({
        id: a.id,
        name: a.name,
        icon: a.icon,
        baseUrl: a.baseUrl,
        goodFor: a.goodFor,
        permission: a.permission,
        capabilities: a.capabilities,
        status: a.status,
        // Owner view: the review state and the tool list the Settings page shows (names and schemas, never the secret).
        ...(owner ? { approved: a.approved, tools: a.tools ?? [] } : {}),
      }));
    // Settings > Apps (`all=1`) also needs to know up front whether to show the Add app form: { apps, owner }.
    // The sidebar and chat read the plain array.
    return NextResponse.json(req.nextUrl.searchParams.get("all") === "1" ? { apps: rows, owner } : rows);
  });
}

export async function POST(req: NextRequest) {
  return withOwner(async ({ userId, email }) => {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.url !== "string") return NextResponse.json({ error: "url is required" }, { status: 400 });
    if (body.approve !== true) return NextResponse.json({ error: "approve: true is required" }, { status: 400 });
    const { app, secret } = await registerApp(body.url, userId, email);
    return NextResponse.json({ app, secret });
  });
}
