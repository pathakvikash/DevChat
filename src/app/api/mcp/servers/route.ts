import { NextRequest, NextResponse } from "next/server";
import { testConnection, disconnectFromServer } from "@/lib/mcp/client";
import { getPrismaMcp } from "@/lib/api/mcpServers";

export async function GET() {
  try {
    const servers = await getPrismaMcp().findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(
      servers.map((s) => ({
        id: s.id,
        name: s.name,
        url: s.url,
        authType: s.authType,
        authConfig: s.authConfig,
        hasAuthToken: !!s.authToken,
        enabled: s.enabled,
        errorMsg: s.errorMsg,
        lastPingAt: s.lastPingAt?.toISOString() || null,
        createdAt: s.createdAt.toISOString(),
      })),
    );
  } catch (error) {
    console.error("[MCP] Failed to list servers:", error);
    return NextResponse.json({ error: "Failed to list MCP servers" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, url, authType, authConfig } = body;

    if (!name || !url) {
      return NextResponse.json({ error: "Name and URL are required" }, { status: 400 });
    }

    const existing = await getPrismaMcp().findUnique({ where: { name } });
    if (existing) {
      return NextResponse.json({ error: "A server with this name already exists" }, { status: 409 });
    }

    const server = await getPrismaMcp().create({
      data: {
        name,
        url,
        authType: authType || "none",
        authConfig: authConfig ? JSON.stringify(authConfig) : null,
        enabled: false,
      },
    });

    // Test connection in background
    testConnection(url, authType, authConfig ? JSON.stringify(authConfig) : undefined).then(
      (result) => {
        getPrismaMcp().update({
          where: { id: server.id },
          data: { errorMsg: result.ok ? null : (result.error || null), lastPingAt: new Date() },
        }).catch(() => {});
      },
    );

    return NextResponse.json({
      id: server.id,
      name: server.name,
      url: server.url,
      authType: server.authType,
      enabled: server.enabled,
    });
  } catch (error) {
    console.error("[MCP] Failed to create server:", error);
    return NextResponse.json({ error: "Failed to create MCP server" }, { status: 500 });
  }
}
