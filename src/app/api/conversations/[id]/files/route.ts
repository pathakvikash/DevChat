import { NextRequest, NextResponse } from "next/server";
import { open } from "fs/promises";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { isRunnableCwd } from "@/lib/claude/sessions";
import { isSecretPath, listFolderFiles, looksBinary, resolveInside } from "@/lib/files/safePath";

const MAX_READ_BYTES = 1024 * 1024;

/** `GET` lists the working folder's files; `GET ?path=` returns one file's text. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      select: { userId: true, workingFolder: true },
    });
    if (!conversation || conversation.userId !== userId) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    const folder = conversation.workingFolder;
    if (!folder || !(await isRunnableCwd(folder))) {
      return NextResponse.json({ error: "This chat has no working folder" }, { status: 400 });
    }

    const rel = req.nextUrl.searchParams.get("path");
    if (rel === null) return NextResponse.json(await listFolderFiles(folder));

    // resolveInside refuses hidden and secret paths; the real path is what gets read.
    const real = await resolveInside(folder, rel);
    if (!real || isSecretPath(real)) return NextResponse.json({ error: "This file can't be attached" }, { status: 403 });

    const handle = await open(real, "r").catch(() => null);
    if (!handle) return NextResponse.json({ error: "File not found" }, { status: 404 });
    try {
      if (!(await handle.stat()).isFile()) return NextResponse.json({ error: "File not found" }, { status: 404 });
      // One read of at most the cap plus one byte, so a file that grows after a stat is still bounded.
      const buf = Buffer.alloc(MAX_READ_BYTES + 1);
      const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
      if (bytesRead > MAX_READ_BYTES) return NextResponse.json({ error: "File is larger than 1 MB" }, { status: 413 });
      const data = buf.subarray(0, bytesRead);
      if (looksBinary(data)) return NextResponse.json({ error: "Binary files can't be attached" }, { status: 415 });
      return NextResponse.json({ path: rel, content: data.toString("utf8") });
    } finally {
      await handle.close();
    }
  } catch (error) {
    console.error("Failed to read files:", error);
    return NextResponse.json({ error: "Failed to read files" }, { status: 500 });
  }
}
