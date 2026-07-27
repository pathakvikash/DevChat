import { NextRequest, NextResponse } from "next/server";
import { listServerTools } from "@/lib/mcp/client";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const tools = await listServerTools(id);
    return NextResponse.json({ tools });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
