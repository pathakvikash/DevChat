import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { folderGoneMessage, isAllowedFolder } from "@/lib/folders";
import { canUseHostTools, HOST_TOOLS_REFUSED } from "@/lib/hostAccess";
import { listFolderFiles, readInside } from "@/lib/files/safePath";

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
    // Working folders live on the host, so only the server's owner may read them.
    if (!(await canUseHostTools(userId))) return NextResponse.json({ error: HOST_TOOLS_REFUSED }, { status: 403 });
    const folder = conversation.workingFolder;
    if (!folder) return NextResponse.json({ error: "This chat has no working folder" }, { status: 400 });
    if (!(await isAllowedFolder(userId, folder))) return NextResponse.json({ error: folderGoneMessage(folder) }, { status: 400 });

    const rel = req.nextUrl.searchParams.get("path");
    if (rel === null) return NextResponse.json(await listFolderFiles(folder));

    // readInside refuses hidden and secret paths and reads only a regular file inside the folder.
    const file = await readInside(folder, rel);
    if (file.ok) return NextResponse.json({ path: rel, content: file.text });
    const failure = {
      refused: ["This file can't be attached", 403],
      missing: ["File not found", 404],
      "too-large": ["File is larger than 1 MB", 413],
      binary: ["Binary files can't be attached", 415],
    }[file.reason] as [string, number];
    return NextResponse.json({ error: failure[0] }, { status: failure[1] });
  } catch (error) {
    console.error("Failed to read files:", error);
    return NextResponse.json({ error: "Failed to read files" }, { status: 500 });
  }
}
