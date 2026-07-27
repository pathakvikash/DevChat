import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getOAuth2Provider, buildAuthorizationUrl } from "@/lib/mcp/oauth2";
import crypto from "crypto";

function getPrismaMcp() {
  return (prisma as any).mcpServer;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const server = await getPrismaMcp().findUnique({ where: { id } });
    if (!server) {
      return NextResponse.json({ error: "MCP server not found" }, { status: 404 });
    }

    let authConfig: Record<string, string> = {};
    if (server.authConfig) {
      try { authConfig = JSON.parse(server.authConfig); } catch {}
    }

    let authorizationUrl = authConfig.authorizationUrl || "";
    let tokenUrl = authConfig.tokenUrl || "";
    const clientId = authConfig.clientId || "";
    const clientSecret = authConfig.clientSecret || "";
    const scopes = authConfig.scopes || "";

    // Look up well-known provider endpoints from server name
    if (!authorizationUrl || !tokenUrl) {
      const provider = getOAuth2Provider(server.name);
      if (provider) {
        if (!authorizationUrl) authorizationUrl = provider.authorizationUrl;
        if (!tokenUrl) tokenUrl = provider.tokenUrl;
      }
    }

    if (!clientId) {
      return NextResponse.json({ error: "OAuth2 Client ID is not configured" }, { status: 400 });
    }
    if (!authorizationUrl) {
      return NextResponse.json({ error: "Authorization URL is not configured" }, { status: 400 });
    }

    const state = crypto.randomBytes(32).toString("hex");

    // Store state in a cookie set to expire in 10 minutes
    const redirectUri = `${_req.nextUrl.origin}/api/mcp/servers/${id}/oauth/callback`;

    const authUrl = buildAuthorizationUrl({
      authorizationUrl,
      clientId,
      redirectUri,
      scopes,
      state,
    });

    const response = NextResponse.redirect(authUrl);

    response.cookies.set("mcp_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: `/api/mcp/servers/${id}/oauth`,
      maxAge: 600,
    });

    // Store code verifier hint and client secret in cookie for callback
    response.cookies.set("mcp_oauth_client_secret", clientSecret, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: `/api/mcp/servers/${id}/oauth`,
      maxAge: 600,
    });

    response.cookies.set("mcp_oauth_token_url", tokenUrl, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: `/api/mcp/servers/${id}/oauth`,
      maxAge: 600,
    });

    return response;
  } catch (error) {
    console.error("[MCP OAuth] Failed to start authorization:", error);
    return NextResponse.json({ error: "Failed to start OAuth2 authorization" }, { status: 500 });
  }
}
