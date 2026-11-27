import { describe, it, expect, vi } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { mcpServer: { findMany: (...a: unknown[]) => findMany(...a), update: vi.fn() } } }));
vi.mock("@/lib/rag", () => ({ searchKb: vi.fn(), REINGEST_NOTE: "" }));
vi.mock("@/lib/mcp/client", () => ({
  listServerTools: vi.fn().mockResolvedValue([{ name: "go", description: "d", inputSchema: { type: "object", properties: {} } }]),
  callServerTool: vi.fn(),
}));

import { buildTools, resolveActiveToolIds } from "@/lib/chat/buildTools";

const user = (text: string) => ({ role: "user", content: [{ type: "text", text }] });
const fetched = (toolName: string) => ({ role: "tool", content: [{ type: "tool-result", toolCallId: "c", toolName, output: { type: "text", value: "page" } }] });

async function approval(id: string, input: unknown, messages: unknown[], mode: "chat" | "agent" = "agent") {
  findMany.mockResolvedValue([{ id: "s1", name: "srv" }]);
  const active = resolveActiveToolIds([], []);
  active.add("mcp_srv_go");
  const tools = await buildTools({ activeToolIds: active, searchProvider: "duckduckgo", userId: "u", contextWindow: 8192, mode, gateUntrusted: true });
  const na = tools[id].needsApproval as (i: unknown, o: unknown) => boolean | Promise<boolean>;
  return typeof na === "function" ? await na(input, { toolCallId: "x", messages }) : !!na;
}

describe("fetchUrl approval", () => {
  it("is offered in chat mode", async () => {
    const tools = await buildTools({ activeToolIds: resolveActiveToolIds([], []), searchProvider: "duckduckgo", userId: "u", contextWindow: 8192, mode: "chat" });
    expect(tools).toHaveProperty("fetchUrl");
  });

  it("does not ask for a URL the user typed, even with punctuation or another case", async () => {
    const ms = [user("what does https://Example.com/docs, do?")];
    expect(await approval("fetchUrl", { url: "https://example.com/docs" }, ms, "chat")).toBe(false);
  });

  it("asks for a model-built URL, a lookalike host, and a user URL with a query appended", async () => {
    const ms = [user("read https://a.com for me")];
    expect(await approval("fetchUrl", { url: "https://other.com/x" }, ms, "chat")).toBe(true);
    expect(await approval("fetchUrl", { url: "https://a.com.evil.io/" }, ms, "chat")).toBe(true);
    expect(await approval("fetchUrl", { url: "https://a.com/?leak=secret" }, ms, "chat")).toBe(true);
    expect(await approval("fetchUrl", { url: "not a url" }, ms, "chat")).toBe(true);
  });

  it("the folder gate still forces approval, even for a URL the user typed", async () => {
    const tools = await buildTools({ activeToolIds: resolveActiveToolIds([], []), searchProvider: "duckduckgo", userId: "u", contextWindow: 8192, mode: "chat", gateUntrusted: true, askBeforeSendingOut: true });
    expect(tools.fetchUrl.needsApproval).toBe(true);
  });

  it("asks for a link that only appears in a fetched page", async () => {
    const ms = [user("summarise https://a.com"), fetched("fetchUrl"), { role: "assistant", content: "see https://b.com" }];
    expect(await approval("fetchUrl", { url: "https://b.com/" }, ms, "chat")).toBe(true);
  });
});

describe("tools that write or send after external text", () => {
  const clean = [user("hi")];
  const tainted = [user("hi"), fetched("fetchUrl")];

  it("ask once a fetched page is in the conversation, and not before", async () => {
    for (const id of ["rememberFact", "mcp_srv_go"]) {
      expect(await approval(id, {}, tainted)).toBe(true);
      expect(await approval(id, {}, clean)).toBe(false);
    }
    expect(await approval("readChat", { id: "c" }, tainted, "chat")).toBe(true);
    expect(await approval("readChat", { id: "c" }, clean, "chat")).toBe(false);
  });

  it("a search result counts too", async () => {
    expect(await approval("rememberFact", {}, [user("hi"), fetched("webSearch")])).toBe(true);
  });
});
