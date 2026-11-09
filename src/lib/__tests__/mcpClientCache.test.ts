import { describe, it, expect, vi, beforeEach } from "vitest";

const listTools = vi.fn();
const connect = vi.fn(async () => {});
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = connect;
    ping = vi.fn(async () => ({}));
    listTools = listTools;
    close = vi.fn(async () => {});
    callTool = vi.fn(async () => ({ content: [] }));
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({ StreamableHTTPClientTransport: class { close = vi.fn(async () => {}); } }));
vi.mock("@/lib/db", () => ({ prisma: { mcpServer: { findUnique: vi.fn(async () => ({ id: "s1", url: "http://x.test/mcp", authType: "none" })) } } }));

import { disconnectFromServer, listServerTools } from "@/lib/mcp/client";

beforeEach(async () => {
  await disconnectFromServer("s1");
  listTools.mockReset();
  listTools.mockResolvedValue({ tools: [{ name: "a" }] });
});

describe("listServerTools cache", () => {
  it("lists once for repeated calls, again when fresh, and again after the server is disconnected", async () => {
    await listServerTools("s1");
    await listServerTools("s1");
    expect(listTools).toHaveBeenCalledTimes(1);
    await listServerTools("s1", { fresh: true });
    expect(listTools).toHaveBeenCalledTimes(2);
    await disconnectFromServer("s1"); // what PATCH and the OAuth callback do
    listTools.mockResolvedValue({ tools: [{ name: "b" }] });
    expect((await listServerTools("s1")).map((t) => t.name)).toEqual(["b"]);
    expect(listTools).toHaveBeenCalledTimes(3);
  });

  it("expires after 30 seconds", async () => {
    vi.useFakeTimers();
    try {
      await listServerTools("s1");
      vi.advanceTimersByTime(31_000);
      await listServerTools("s1");
      expect(listTools).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
