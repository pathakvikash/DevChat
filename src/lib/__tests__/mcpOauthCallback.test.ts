import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn(async () => "u1") }));
const exchangeCode = vi.fn(async (_a: unknown) => ({ access_token: "at", refresh_token: "rt", expires_in: 3600 }));
vi.mock("@/lib/mcp/oauth2", () => ({ exchangeCode: (a: unknown) => exchangeCode(a) }));
const disconnect = vi.fn(async (_id: string) => {});
vi.mock("@/lib/mcp/client", () => ({ disconnectFromServer: (id: string) => disconnect(id) }));
const update = vi.fn(async (_a: unknown) => ({}));
vi.mock("@/lib/api/mcpServers", () => ({
  getPrismaMcp: () => ({ update }),
  findMcpServer: vi.fn(async () => ({ ok: true, server: { id: "s1", authConfig: JSON.stringify({ clientId: "cid", clientSecret: "db-secret" }) } })),
}));

import { GET } from "@/app/api/mcp/servers/[id]/oauth/callback/route";

describe("OAuth callback", () => {
  it("takes the client secret from the database, never from a cookie, and drops the cached connection after storing tokens", async () => {
    const req = new NextRequest("http://localhost/api/mcp/servers/s1/oauth/callback?code=abc&state=st", {
      headers: { cookie: "mcp_oauth_state=st; mcp_oauth_token_url=http://idp.test/token; mcp_oauth_client_secret=cookie-secret" },
    });
    const res = await GET(req, { params: Promise.resolve({ id: "s1" }) });
    expect(res.headers.get("location")).toContain("oauth=success");
    expect(exchangeCode).toHaveBeenCalledWith(expect.objectContaining({ clientId: "cid", clientSecret: "db-secret", tokenUrl: "http://idp.test/token" }));
    expect(JSON.stringify(exchangeCode.mock.calls)).not.toContain("cookie-secret");
    expect(update).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledWith("s1");
  });
});
