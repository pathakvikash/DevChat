import { NextRequest, NextResponse } from "next/server";
import { testConnection } from "@/lib/mcp/client";
import { getPrismaMcp, findMcpServer, mcpServerNotFoundResponse } from "@/lib/api/mcpServers";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const lookup = await findMcpServer(id);
    if (!lookup.ok) {
      return mcpServerNotFoundResponse();
    }
    const { server } = lookup;
    const result = await testConnection(
      server.url,
      server.authType,
      server.authConfig ?? undefined,
      server.authToken ?? undefined,
    );
    await getPrismaMcp().update({
      where: { id },
      data: { errorMsg: result.ok ? null : (result.error || null), lastPingAt: new Date() },
    });
    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
