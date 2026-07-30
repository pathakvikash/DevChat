import { NextRequest, NextResponse } from "next/server";
import { disconnectFromServer } from "@/lib/mcp/client";
import { getPrismaMcp, findMcpServer, mcpServerNotFoundResponse } from "@/lib/api/mcpServers";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const result = await findMcpServer(id);
    if (!result.ok) {
      return mcpServerNotFoundResponse();
    }
    const { server } = result;
    return NextResponse.json({
      id: server.id,
      name: server.name,
      url: server.url,
      authType: server.authType,
      authConfig: server.authConfig,
      hasAuthToken: !!server.authToken,
      enabled: server.enabled,
      errorMsg: server.errorMsg,
      lastPingAt: server.lastPingAt?.toISOString() || null,
      createdAt: server.createdAt.toISOString(),
    });
  } catch (error) {
    console.error("[MCP] Failed to get server:", error);
    return NextResponse.json({ error: "Failed to get MCP server" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = await req.json();
    const result = await findMcpServer(id);
    if (!result.ok) {
      return mcpServerNotFoundResponse();
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.url !== undefined) data.url = body.url;
    if (body.authType !== undefined) data.authType = body.authType;
    if (body.authConfig !== undefined) data.authConfig = JSON.stringify(body.authConfig);
    if (body.enabled !== undefined) data.enabled = body.enabled;
    if (body.token !== undefined) data.authToken = JSON.stringify(body.token);

    const server = await getPrismaMcp().update({ where: { id }, data });

    if (body.enabled === false) {
      await disconnectFromServer(id).catch(() => {});
    }

    return NextResponse.json({
      id: server.id,
      name: server.name,
      url: server.url,
      authType: server.authType,
      enabled: server.enabled,
    });
  } catch (error) {
    console.error("[MCP] Failed to update server:", error);
    return NextResponse.json({ error: "Failed to update MCP server" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await disconnectFromServer(id).catch(() => {});
    await getPrismaMcp().delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[MCP] Failed to delete server:", error);
    return NextResponse.json({ error: "Failed to delete MCP server" }, { status: 500 });
  }
}
