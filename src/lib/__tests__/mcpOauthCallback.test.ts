import crypto from "crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn(async () => "u1") }));
const exchangeCode = vi.fn(async (_a: unknown) => ({ access_token: "at", refresh_token: "rt", expires_in: 3600 }));
vi.mock("@/lib/mcp/oauth2", () => ({ exchangeCode: (a: unknown) => exchangeCode(a) }));
const disconnect = vi.fn(async (_id: string) => {});
vi.mock("@/lib/mcp/client", () => ({ disconnectFromServer: (id: string) => disconnect(id) }));
const update = vi.fn(async (_a: unknown) => ({}));
let server = { id: "s1", url: "http://a.test/mcp", authType: "oauth2", authConfig: JSON.stringify({ clientId: "cid", clientSecret: "db-secret" }) };
vi.mock("@/lib/api/mcpServers", () => ({
  getPrismaMcp: () => ({ update }),
  findMcpServer: vi.fn(async () => ({ ok: true, server })),
}));

import { GET } from "@/app/api/mcp/servers/[id]/oauth/callback/route";

const hash = (u: string) => crypto.createHash("sha256").update(u).digest("hex");
const call = (urlHash = hash("http://a.test/mcp")) =>
  GET(
    new NextRequest("http://localhost/api/mcp/servers/s1/oauth/callback?code=abc&state=st", {
      headers: { cookie: `mcp_oauth_state=st; mcp_oauth_token_url=http://idp.test/token; mcp_oauth_client_secret=cookie-secret; mcp_oauth_server=${urlHash}` },
    }),
    { params: Promise.resolve({ id: "s1" }) },
  );

beforeEach(() => {
  exchangeCode.mockClear();
  update.mockClear();
  disconnect.mockClear();
  server = { id: "s1", url: "http://a.test/mcp", authType: "oauth2", authConfig: JSON.stringify({ clientId: "cid", clientSecret: "db-secret" }) };
});

describe("OAuth callback", () => {
  it("takes the client secret from the database, never from a cookie, and drops the cached connection after storing tokens", async () => {
    const res = await call();
    expect(res.headers.get("location")).toContain("oauth=success");
    expect(exchangeCode).toHaveBeenCalledWith(expect.objectContaining({ clientId: "cid", clientSecret: "db-secret", tokenUrl: "http://idp.test/token" }));
    expect(JSON.stringify(exchangeCode.mock.calls)).not.toContain("cookie-secret");
    expect(update).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledWith("s1");
  });

  it("refuses when the server's address changed since authorize, or it is no longer oauth2", async () => {
    server = { ...server, url: "http://evil.test/mcp" };
    expect((await call()).headers.get("location")).toContain("reason=server_changed");
    server = { ...server, url: "http://a.test/mcp", authType: "apikey" };
    expect((await call()).headers.get("location")).toContain("reason=server_changed");
    expect((await call("")).headers.get("location")).toContain("reason=server_changed");
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
