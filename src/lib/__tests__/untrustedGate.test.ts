import { describe, it, expect, vi } from "vitest";

const findMany = vi.fn();
const msgFirst = vi.fn();
const artFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { mcpServer: { findMany: (...a: unknown[]) => findMany(...a), update: vi.fn() }, message: { findFirst: (...a: unknown[]) => msgFirst(...a) }, artifact: { findFirst: (...a: unknown[]) => artFirst(...a) } },
}));
vi.mock("@/lib/rag", () => ({ searchKb: vi.fn(), REINGEST_NOTE: "" }));
vi.mock("@/lib/mcp/client", () => ({
  listServerTools: vi.fn().mockResolvedValue([{ name: "go", description: "d", inputSchema: { type: "object", properties: {} } }]),
  callServerTool: vi.fn(),
}));

import { storedTaint, hasExternalText } from "@/lib/chat/untrustedGate";
import { askAfterExternalText, buildTools, messageAgentTool, resolveActiveToolIds, runAgentTool } from "@/lib/chat/buildTools";

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

  it("spawning a helper (runAgent, messageAgent) asks after a fetch, not before", async () => {
    const tools = await buildTools({ activeToolIds: resolveActiveToolIds([], []), searchProvider: "duckduckgo", userId: "u", contextWindow: 8192, mode: "agent" });
    const opts = { userId: "u", parentId: "p", model: {} as never, mode: "agent" as const, providerOptions: undefined, maxParallel: 1, activeChildren: new Set<string>() };
    for (const t of [askAfterExternalText(runAgentTool(tools, opts)), askAfterExternalText(messageAgentTool(tools, opts))]) {
      const na = t.needsApproval as (i: unknown, o: unknown) => Promise<boolean>;
      expect(await na({}, { messages: clean })).toBe(false);
      expect(await na({}, { messages: tainted })).toBe(true);
    }
  });

  it("a search result counts too", async () => {
    expect(await approval("rememberFact", {}, [user("hi"), fetched("webSearch")])).toBe(true);
  });
});

describe("more external text and stored taint", () => {
  it("runAgent, messageAgent, readChat and searchChats results count as external text", () => {
    for (const n of ["runAgent", "messageAgent", "readChat", "searchChats", "app_x_y", "mcp_a_b"]) expect(hasExternalText([fetched(n)])).toBe(true);
    expect(hasExternalText([fetched("calculator")])).toBe(false);
  });

  it("storedTaint asks one cheap query on the stored assistant messages, selecting no parts", async () => {
    msgFirst.mockResolvedValue({ id: "m" });
    expect(await storedTaint("c1")).toBe(true);
    const arg = msgFirst.mock.calls[0][0];
    expect(arg.where).toMatchObject({ conversationId: "c1", role: "assistant" });
    expect(arg.select).toEqual({ id: true });
    const marks = arg.where.OR.map((o: any) => o.parts.contains).join("\n");
    for (const n of ["tool-fetchUrl", "tool-webSearch", "tool-mcp_", "tool-app_", "tool-runAgent", "tool-messageAgent", "tool-readChat", "tool-searchChats", '"toolName":"fetchUrl"']) expect(marks).toContain(n);
    msgFirst.mockResolvedValue(null);
    expect(await storedTaint("c1")).toBe(false);
    expect(await storedTaint(undefined)).toBe(false);
  });

  it("gateUntrusted { tainted } asks with no external text in the live messages; { tainted: false } does not", async () => {
    findMany.mockResolvedValue([{ id: "s1", name: "srv" }]);
    const active = resolveActiveToolIds([], []);
    active.add("mcp_srv_go");
    const mk = (tainted: boolean) => buildTools({ activeToolIds: active, searchProvider: "duckduckgo", userId: "u", contextWindow: 8192, mode: "agent", gateUntrusted: { tainted } });
    const ask = async (tools: Record<string, any>, id: string, input: unknown = {}) => {
      const na = tools[id].needsApproval;
      return typeof na === "function" ? await na(input, { toolCallId: "x", messages: [user("hi")] }) : !!na;
    };
    const t = await mk(true);
    const c = await mk(false);
    for (const id of ["rememberFact", "mcp_srv_go", "readChat"]) {
      expect(await ask(t, id)).toBe(true);
      expect(await ask(c, id)).toBe(false);
    }
    const [wrapped, plain] = [askAfterExternalText(c.rememberFact, true), askAfterExternalText(c.rememberFact)];
    expect(await (wrapped.needsApproval as any)({}, { messages: [] })).toBe(true);
    expect(await (plain.needsApproval as any)({}, { messages: [] })).toBe(false);
  });

  it("after external text, an HTML artifact and executeCode ask; a non-HTML artifact does not", async () => {
    findMany.mockResolvedValue([]);
    const tools: Record<string, any> = await buildTools({ activeToolIds: resolveActiveToolIds([], []), searchProvider: "duckduckgo", userId: "u", conversationId: "c1", contextWindow: 8192, mode: "agent", gateUntrusted: { tainted: false } });
    const ask = async (id: string, input: unknown, messages: unknown[]) => {
      const na = tools[id]?.needsApproval;
      return typeof na === "function" ? await na(input, { toolCallId: "x", messages }) : !!na;
    };
    const tainted = [user("hi"), fetched("webSearch")];
    expect(await ask("createArtifact", { type: "html" }, tainted)).toBe(true);
    expect(await ask("createArtifact", { type: "html" }, [user("hi")])).toBe(false);
    expect(await ask("createArtifact", { type: "document" }, tainted)).toBe(false);
    artFirst.mockResolvedValue({ type: "html" });
    expect(await ask("updateArtifact", { artifactId: "a" }, tainted)).toBe(true);
    artFirst.mockResolvedValue({ type: "document" });
    expect(await ask("updateArtifact", { artifactId: "a" }, tainted)).toBe(false);
    if (tools.executeCode) {
      expect(await ask("executeCode", {}, tainted)).toBe(true);
      expect(await ask("executeCode", {}, [user("hi")])).toBe(false);
    }
  });
});
