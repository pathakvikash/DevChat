import { describe, it, expect, vi, beforeEach } from "vitest";

const transportOpts: { requestInit?: { headers?: Record<string, string> } }[] = [];
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = vi.fn(async () => {});
    listTools = vi.fn(async () => ({ tools: [] }));
    close = vi.fn(async () => {});
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {
    constructor(_url: unknown, opts: (typeof transportOpts)[number]) {
      transportOpts.push(opts);
    }
    close = vi.fn(async () => {});
  },
}));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn(async () => "u1") }));
const update = vi.fn(async (_a: { data: Record<string, unknown> }) => ({ id: "s1", name: "n", url: "u", authType: "none", enabled: true }));
let stored = { id: "s1", userId: "u1", url: "http://a.test/mcp", authType: "oauth2", authConfig: null as string | null };
vi.mock("@/lib/api/mcpServers", async (orig) => ({
  ...(await orig<object>()),
  getPrismaMcp: () => ({ update }),
  findMcpServer: vi.fn(async () => ({ ok: true, server: stored })),
}));

import { testConnection } from "@/lib/mcp/client";
import { PATCH } from "@/app/api/mcp/servers/[id]/route";
import { NextRequest } from "next/server";

const token = JSON.stringify({ access_token: "stale-token" });
beforeEach(() => {
  transportOpts.length = 0;
  update.mockClear();
  stored = { id: "s1", userId: "u1", url: "http://a.test/mcp", authType: "oauth2", authConfig: null };
});

describe("a stored OAuth token", () => {
  it("is sent only to an oauth2 server", async () => {
    await testConnection("http://a.test", "oauth2", undefined, token);
    await testConnection("http://a.test", "none", undefined, token);
    await testConnection("http://a.test", "apikey", JSON.stringify({ apiKey: "k" }), token);
    expect(transportOpts.map((o) => o.requestInit?.headers?.Authorization)).toEqual(["Bearer stale-token", undefined, "Bearer k"]);
  });

  const patch = (body: object) =>
    PATCH(new NextRequest("http://localhost/api/mcp/servers/s1", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "s1" }) });

  it("is cleared when the auth type leaves oauth2 or the URL changes, and kept otherwise", async () => {
    await patch({ authType: "apikey" });
    expect(update.mock.calls[0][0].data.authToken).toBeNull();
    await patch({ url: "http://other.test/mcp" });
    expect(update.mock.calls[1][0].data.authToken).toBeNull();
    await patch({ name: "renamed" });
    expect(update.mock.calls[2][0].data).not.toHaveProperty("authToken");
    await patch({ authType: "oauth2", url: "http://a.test/mcp" });
    expect(update.mock.calls[3][0].data).not.toHaveProperty("authToken");
  });

  it("a token set in the same request is kept when the URL changes", async () => {
    await patch({ url: "http://other.test/mcp", token: { access_token: "fresh" } });
    expect(update.mock.calls[0][0].data.authToken).toBe(JSON.stringify({ access_token: "fresh" }));
  });
});
