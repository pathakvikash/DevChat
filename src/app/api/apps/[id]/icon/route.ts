import { NextRequest, NextResponse } from "next/server";
import { getApp } from "@/lib/apps/registry";
import { withUser } from "@/lib/apps/http";
import { appFetch } from "@/lib/net/safeFetch";

const MAX_ICON_BYTES = 256 * 1024;
const TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/x-icon", "image/vnd.microsoft.icon"]); // no SVG: it can carry script
const notFound = () => new NextResponse(null, { status: 404 });

/** The app's manifest icon, fetched server-side so the CSP's img-src stays 'self'. Any problem is a 404 and the UI shows the letter tile. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withUser(async ({ userId }) => {
    const app = await getApp(userId, id);
    if (!app?.icon) return notFound();
    try {
      // The registry pins icon to the app's origin when it stores the manifest; checked again here.
      if (new URL(app.icon).origin !== new URL(app.baseUrl).origin) return notFound();
      // appFetch: redirects are refused, production also blocks private hosts.
      const res = await appFetch(app.icon, { signal: AbortSignal.any([AbortSignal.timeout(5000), req.signal]) });
      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!res.ok || !res.body || !TYPES.has(type) || Number(res.headers.get("content-length") ?? 0) > MAX_ICON_BYTES) {
        await res.body?.cancel();
        return notFound();
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const c of res.body as unknown as AsyncIterable<Uint8Array>) {
        size += c.byteLength;
        if (size > MAX_ICON_BYTES) return notFound();
        chunks.push(c);
      }
      return new Response(Buffer.concat(chunks), {
        headers: {
          "Content-Type": type,
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'",
          "Cache-Control": "private, max-age=86400",
        },
      });
    } catch {
      return notFound();
    }
  });
}
