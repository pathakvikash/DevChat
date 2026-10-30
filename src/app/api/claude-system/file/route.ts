import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join, resolve, sep } from "path";
import { requireUserId } from "@/lib/auth";
import { canUseHostTools, HOST_TOOLS_REFUSED } from "@/lib/hostAccess";

const CLAUDE_DIR = resolve(join(homedir(), ".claude"));

function isInsideClaude(filePath: string): boolean {
  const resolved = resolve(filePath);
  return resolved === CLAUDE_DIR || resolved.startsWith(CLAUDE_DIR + sep);
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
