import { NextRequest, NextResponse } from "next/server";
import { listServerTools } from "@/lib/mcp/client";
import { findMcpServer, mcpServerNotFoundResponse } from "@/lib/api/mcpServers";
import { requireUserId } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const userId = await requireUserId();
    const lookup = await findMcpServer(id, userId);
    if (!lookup.ok) {
      return mcpServerNotFoundResponse();
    }
    const tools = await listServerTools(id);
    return NextResponse.json({ tools });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
