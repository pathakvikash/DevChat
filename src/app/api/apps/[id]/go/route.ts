import { NextRequest, NextResponse } from "next/server";
import { getApp, getAppSecret } from "@/lib/apps/registry";
import { signHandoffToken } from "@/lib/apps/token";
import { buildGoUrl, GoError } from "@/lib/apps/go";
import { withUser } from "@/lib/apps/http";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withUser(async ({ userId, email }) => {
    const app = await getApp(userId, id);
    if (!app) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const q = req.nextUrl.searchParams;
    try {
      const url = await buildGoUrl(app, q.get("link"), q.get("params"), async () => {
        const secret = await getAppSecret(app.id);
        if (!secret) throw new GoError("App has no secret");
        return signHandoffToken({ appId: app.id, email, secret });
      });
      return NextResponse.redirect(url, 302);
    } catch (e) {
      if (e instanceof GoError) return NextResponse.json({ error: e.message }, { status: 400 });
      throw e;
    }
  });
}
