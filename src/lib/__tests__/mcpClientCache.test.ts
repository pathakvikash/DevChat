import { describe, it, expect, vi, beforeEach } from "vitest";

const listTools = vi.fn();
const connect = vi.fn(async () => {});
const closeClient = vi.fn(async () => {});
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = connect;
    ping = vi.fn(async () => ({}));
    listTools = listTools;
    close = closeClient;
    callTool = vi.fn(async () => ({ content: [] }));
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({ StreamableHTTPClientTransport: class { close = vi.fn(async () => {}); } }));
const findUnique = vi.fn(async () => ({ id: "s1", url: "http://x.test/mcp", authType: "none" }));
vi.mock("@/lib/db", () => ({ prisma: { mcpServer: { findUnique: () => findUnique() } } }));

import { disconnectFromServer, listServerTools } from "@/lib/mcp/client";

beforeEach(async () => {
  await disconnectFromServer("s1");
  listTools.mockReset();
  listTools.mockResolvedValue({ tools: [{ name: "a" }] });
  connect.mockClear();
  closeClient.mockClear();
  connect.mockImplementation(async () => {});
  findUnique.mockClear();
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

describe("an edit that lands while connecting", () => {
  it("does not leave the stale connection cached: it reconnects from the database", async () => {
    connect.mockImplementationOnce(async () => {
      await disconnectFromServer("s1"); // the PATCH, between the lookup and the cache write
    });
    await listServerTools("s1");
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenCalledTimes(2);
    await listServerTools("s1");
    expect(connect).toHaveBeenCalledTimes(2); // the second connection is the one that stuck
  });

  it("closes the client as well as the transport when it starts over", async () => {
    connect.mockImplementationOnce(async () => {
      await disconnectFromServer("s1");
    });
    await listServerTools("s1");
    expect(closeClient).toHaveBeenCalledTimes(1);
  });

  it("two cold connects at once share one connection", async () => {
    connect.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    await Promise.all([listServerTools("s1", { fresh: true }), listServerTools("s1", { fresh: true })]);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("does not cache a tool list that was fetched across an invalidation", async () => {
    listTools.mockImplementationOnce(async () => {
      await disconnectFromServer("s1");
      return { tools: [{ name: "old" }] };
    });
    await listServerTools("s1");
    listTools.mockResolvedValue({ tools: [{ name: "new" }] });
    expect((await listServerTools("s1")).map((t) => t.name)).toEqual(["new"]);
  });
});
