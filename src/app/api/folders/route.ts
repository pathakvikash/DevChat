import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { addFolder, allowedFolders, folderAccessForPage, removeFolder } from "@/lib/folders";

export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await requireUserId();
    const [folders, access] = await Promise.all([allowedFolders(userId), folderAccessForPage(userId)]);
    return NextResponse.json({ folders, ...access });
  } catch (error) {
    console.error("Failed to list folders:", error);
    return NextResponse.json({ error: "Failed to list folders" }, { status: 500 });
  }
}

async function body(req: NextRequest): Promise<{ path?: unknown } | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const b = await body(req);
    if (!b) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const r = await addFolder(userId, b.path);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ folder: { path: r.path, source: "added" } }, { status: r.added ? 201 : 200 });
  } catch (error) {
    console.error("Failed to add folder:", error);
    return NextResponse.json({ error: "Failed to add folder" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const b = await body(req);
    if (!b) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const r = await removeFolder(userId, b.path);
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
  } catch (error) {
    console.error("Failed to remove folder:", error);
    return NextResponse.json({ error: "Failed to remove folder" }, { status: 500 });
  }
}
