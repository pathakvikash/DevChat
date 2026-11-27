import { NextRequest, NextResponse } from "next/server";
import { canUseHostTools } from "@/lib/hostAccess";
import { listApps, registerApp } from "@/lib/apps/registry";
import { withOwner, withUser } from "@/lib/apps/http";

export async function GET() {
  return withUser(async ({ userId }) => {
    const owner = await canUseHostTools(userId);
    const apps = await listApps(userId, { includeUnapproved: owner });
    return NextResponse.json(
      apps.map((a) => ({
        id: a.id,
        name: a.name,
        icon: a.icon,
        baseUrl: a.baseUrl,
        goodFor: a.goodFor,
        permission: a.permission,
        capabilities: a.capabilities,
        status: a.status,
        ...(owner ? { approved: a.approved } : {}),
      })),
    );
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
