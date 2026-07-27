import { NextRequest, NextResponse } from "next/server";
import { callServerTool } from "@/lib/mcp/client";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = await req.json();
    const { toolName, args } = body;
    if (!toolName) {
      return NextResponse.json({ error: "toolName is required" }, { status: 400 });
    }
    const result = await callServerTool(id, toolName, args || {});
    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
