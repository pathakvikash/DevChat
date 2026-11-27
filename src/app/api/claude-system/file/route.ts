import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, realpathSync } from "fs";
import { homedir } from "os";
import { basename, dirname, join, resolve, sep } from "path";
import { requireUserId } from "@/lib/auth";
import { canUseHostTools, HOST_TOOLS_REFUSED } from "@/lib/hostAccess";

const CLAUDE_DIR = resolve(join(homedir(), ".claude"));

/** Follows symlinks (of the file, or for a new file its parent) so a link inside ~/.claude can't point out of it. */
function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    const parent = dirname(p);
    return parent === p ? p : join(real(parent), basename(p));
  }
}

function isInsideClaude(filePath: string): boolean {
  const resolved = real(resolve(filePath));
  const root = real(CLAUDE_DIR);
  return resolved === root || resolved.startsWith(root + sep);
}

export async function POST(req: NextRequest) {
  const userId = await requireUserId();
  if (!(await canUseHostTools(userId))) return NextResponse.json({ error: HOST_TOOLS_REFUSED }, { status: 403 });
  try {
    const { path, content } = await req.json();
    if (!path || typeof path !== "string") {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }
    if (!isInsideClaude(path)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    if (content !== undefined) {
      writeFileSync(path, content, "utf-8");
      return NextResponse.json({ success: true });
    }
    if (!existsSync(path)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    const full = readFileSync(path, "utf-8");
    return NextResponse.json({ content: full });
  } catch (e) {
    console.error("Failed to read/write claude file:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
