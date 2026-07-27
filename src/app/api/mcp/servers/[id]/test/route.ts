import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { testConnection } from "@/lib/mcp/client";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const server = await (prisma as any).mcpServer.findUnique({ where: { id } });
    if (!server) {
      return NextResponse.json({ error: "MCP server not found" }, { status: 404 });
    }
    const result = await testConnection(server.url, server.authType, server.authConfig, server.authToken);
    await (prisma as any).mcpServer.update({
      where: { id },
      data: { errorMsg: result.ok ? null : (result.error || null), lastPingAt: new Date() },
    });
    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
