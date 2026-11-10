import { NextRequest, NextResponse } from "next/server";
import { disconnectFromServer } from "@/lib/mcp/client";
import { getPrismaMcp, findMcpServer, mcpServerNotFoundResponse, mergeAuthConfig, redactAuthConfig } from "@/lib/api/mcpServers";
import { requireUserId } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const userId = await requireUserId();
    const result = await findMcpServer(id, userId);
    if (!result.ok) {
      return mcpServerNotFoundResponse();
    }
    const { server } = result;
    return NextResponse.json({
      id: server.id,
      name: server.name,
      url: server.url,
      authType: server.authType,
      ...redactAuthConfig(server.authConfig),
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
    const userId = await requireUserId();
    const body = await req.json();
    const result = await findMcpServer(id, userId);
    if (!result.ok) {
      return mcpServerNotFoundResponse();
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.url !== undefined) data.url = body.url;
    if (body.authType !== undefined) data.authType = body.authType;
    if (body.authConfig !== undefined || body.authType !== undefined) {
      data.authConfig = mergeAuthConfig(result.server.authConfig, body.authConfig ?? {}, body.authType ?? result.server.authType);
    }
    if (body.enabled !== undefined) data.enabled = body.enabled;
    if (body.token !== undefined) data.authToken = JSON.stringify(body.token);

    // The stored OAuth token goes when the server stops using oauth2 or moves to another address.
    if (body.token === undefined && ((body.authType !== undefined && body.authType !== "oauth2") || (body.url !== undefined && body.url !== result.server.url))) data.authToken = null;
    const server = await getPrismaMcp().update({ where: { id }, data });
    // A changed address or credentials make the cached connection and tool list stale.
    if (["url", "authType", "authConfig", "authToken"].some((k) => k in data)) await disconnectFromServer(id).catch(() => {});

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
    const userId = await requireUserId();
    const result = await findMcpServer(id, userId);
    if (!result.ok) {
      return mcpServerNotFoundResponse();
    }
    await disconnectFromServer(id).catch(() => {});
    await getPrismaMcp().delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[MCP] Failed to delete server:", error);
    return NextResponse.json({ error: "Failed to delete MCP server" }, { status: 500 });
  }
}
