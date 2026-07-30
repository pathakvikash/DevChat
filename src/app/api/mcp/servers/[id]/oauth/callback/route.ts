import { NextRequest, NextResponse } from "next/server";
import { exchangeCode } from "@/lib/mcp/oauth2";
import { getPrismaMcp, findMcpServer } from "@/lib/api/mcpServers";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const { searchParams } = req.nextUrl;
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    if (error) {
      return NextResponse.redirect(
        new URL(`/settings/mcp?oauth=error&reason=${encodeURIComponent(error)}`, req.url),
      );
    }

    if (!code) {
      return NextResponse.redirect(
        new URL("/settings/mcp?oauth=error&reason=no_code", req.url),
      );
    }

    // Validate state
    const storedState = req.cookies.get("mcp_oauth_state")?.value;
    if (!storedState || storedState !== state) {
      return NextResponse.redirect(
        new URL("/settings/mcp?oauth=error&reason=state_mismatch", req.url),
      );
    }

    const clientSecret = req.cookies.get("mcp_oauth_client_secret")?.value || "";
    const tokenUrl = req.cookies.get("mcp_oauth_token_url")?.value || "";

    // Clear cookies
    const clearResponse = NextResponse.redirect(new URL("/settings/mcp?oauth=success", req.url));
    clearResponse.cookies.set("mcp_oauth_state", "", { maxAge: 0, path: `/api/mcp/servers/${id}/oauth` });
    clearResponse.cookies.set("mcp_oauth_client_secret", "", { maxAge: 0, path: `/api/mcp/servers/${id}/oauth` });
    clearResponse.cookies.set("mcp_oauth_token_url", "", { maxAge: 0, path: `/api/mcp/servers/${id}/oauth` });

    if (!tokenUrl) {
      return clearResponse;
    }

    const result = await findMcpServer(id);
    if (!result.ok) {
      return clearResponse;
    }
    const { server } = result;

    let authConfig: Record<string, string> = {};
    if (server.authConfig) {
      try { authConfig = JSON.parse(server.authConfig); } catch {}
    }

    const clientId = authConfig.clientId || "";
    const redirectUri = `${req.nextUrl.origin}/api/mcp/servers/${id}/oauth/callback`;

    const tokens = await exchangeCode({
      tokenUrl,
      clientId,
      clientSecret,
      code,
      redirectUri,
    });

    // Store tokens in the server record
    await getPrismaMcp().update({
      where: { id },
      data: {
        authToken: JSON.stringify({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_in: tokens.expires_in,
          obtained_at: Date.now(),
        }),
        errorMsg: null,
      },
    });

    return clearResponse;
  } catch (error) {
    console.error("[MCP OAuth] Callback failed:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.redirect(
      new URL(`/settings/mcp?oauth=error&reason=${encodeURIComponent(msg)}`, req.url),
    );
  }
}
