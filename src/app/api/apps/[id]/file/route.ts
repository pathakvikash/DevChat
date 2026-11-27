import { NextRequest, NextResponse } from "next/server";
import { getApp, openAppFile } from "@/lib/apps/registry";
import { withUser } from "@/lib/apps/http";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const NAME = /^[A-Za-z0-9._-]{1,128}$/;
const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/** Streams `{baseUrl}/api/orrery/file?name=` for the signed-in user. Binary-safe, capped at 25 MB, type forced to STL. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withUser(async ({ userId, email }) => {
    const name = req.nextUrl.searchParams.get("name") ?? "";
    if (!NAME.test(name) || name.startsWith(".")) return notFound();
    if (!(await getApp(userId, id))) return notFound();
    const upstream = await openAppFile(id, email, name, req.signal);
    if (!upstream || !upstream.ok || !upstream.body) return notFound();
    const declared = Number(upstream.headers.get("content-length") ?? 0);
    if (declared > MAX_FILE_BYTES) {
      await upstream.body.cancel();
      return NextResponse.json({ error: "File is over 25 MB" }, { status: 413 });
    }
    let seen = 0;
    const capped = upstream.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          seen += chunk.byteLength;
          if (seen > MAX_FILE_BYTES) controller.error(new Error("File is over 25 MB"));
          else controller.enqueue(chunk);
        },
      }),
    );
    return new Response(capped, {
      headers: {
        "Content-Type": "model/stl",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  });
}
