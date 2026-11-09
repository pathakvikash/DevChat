import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { prisma } from "@/lib/db";

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

interface McpCallResult {
  content: unknown[];
  isError?: boolean;
}

/** In-memory cache of connected MCP clients keyed by server ID. */
const clientCache = new Map<string, { client: Client; transport: StreamableHTTPClientTransport }>();

function makeHeaders(
  authType: string,
  authConfig?: string | null,
  authToken?: string | null,
): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (authType === "apikey" && authConfig) {
    try {
      const cfg = JSON.parse(authConfig);
      if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
    } catch {}
  }

  // A leftover token from an earlier oauth2 setup must not go to a server that no longer uses oauth2.
  if (authToken && authType === "oauth2") {
    try {
      const token = JSON.parse(authToken);
      if (token.access_token) headers.Authorization = `Bearer ${token.access_token}`;
    } catch {}
  }

  return headers;
}

/** Cold connects in flight, so two callers at once share one connection instead of the later overwriting the earlier. */
const connecting = new Map<string, Promise<void>>();

function connectToServer(serverId: string): Promise<void> {
  const running = connecting.get(serverId);
  if (running) return running;
  const p = doConnect(serverId).finally(() => connecting.delete(serverId));
  connecting.set(serverId, p);
  return p;
}

async function doConnect(serverId: string): Promise<void> {
  const existing = clientCache.get(serverId);
  if (existing) {
    try { await existing.client.ping(); return; } catch {
      clientCache.delete(serverId);
    }
  }

  const gen = genOf(serverId);
  const server = await (prisma as any).mcpServer.findUnique({ where: { id: serverId } });
  if (!server) throw new Error(`MCP server "${serverId}" not found`);

  const headers = makeHeaders(server.authType, server.authConfig, server.authToken);

  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: { headers },
  });

  const client = new Client(
    { name: "vas-mcp-client", version: "1.0.0" },
    { capabilities: {} },
  );

  await client.connect(transport);
  if (genOf(serverId) !== gen) {
    // The server was edited while this connected (its address or credentials may be old): start over from the database.
    try { await transport.close(); } catch {}
    try { await client.close(); } catch {}
    return doConnect(serverId);
  }
  clientCache.set(serverId, { client, transport });
}

/** A server's tool list is kept this long, so a workflow run lists it once, not once per item or per check. */
const TOOLS_TTL_MS = 30_000;
const toolsCache = new Map<string, { at: number; tools: McpTool[] }>();
/** Bumped whenever a server is invalidated, so a connect or list that started before it can't cache stale results. */
const generation = new Map<string, number>();
const genOf = (serverId: string) => generation.get(serverId) ?? 0;

export async function disconnectFromServer(serverId: string): Promise<void> {
  generation.set(serverId, genOf(serverId) + 1);
  toolsCache.delete(serverId);
  const entry = clientCache.get(serverId);
  if (!entry) return;
  try { await entry.transport.close(); } catch {}
  try { await entry.client.close(); } catch {}
  clientCache.delete(serverId);
}

export async function listServerTools(serverId: string, opts: { fresh?: boolean } = {}): Promise<McpTool[]> {
  const hit = toolsCache.get(serverId);
  if (!opts.fresh && hit && Date.now() - hit.at < TOOLS_TTL_MS) return hit.tools;
  await connectToServer(serverId);
  const gen = genOf(serverId);
  const entry = clientCache.get(serverId);
  if (!entry) throw new Error(`MCP server "${serverId}" not connected`);

  const result = await entry.client.listTools();
  const tools = result.tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
  if (genOf(serverId) === gen) toolsCache.set(serverId, { at: Date.now(), tools });
  return tools;
}

export async function callServerTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
  opts: { signal?: AbortSignal } = {},
): Promise<McpCallResult> {
  await connectToServer(serverId);
  const entry = clientCache.get(serverId);
  if (!entry) throw new Error(`MCP server "${serverId}" not connected`);

  const result = await entry.client.callTool({ name: toolName, arguments: args }, undefined, { signal: opts.signal });

  return {
    content: result.content as unknown[],
    isError: result.isError ? true : undefined,
  };
}

export async function testConnection(
  url: string,
  authType?: string,
  authConfig?: string,
  authToken?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const headers = makeHeaders(authType || "none", authConfig, authToken);

    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers },
    });

    const client = new Client(
      { name: "vas-mcp-client", version: "1.0.0" },
      { capabilities: {} },
    );

    await client.connect(transport);
    await client.listTools();

    try { await transport.close(); } catch {}
    try { await client.close(); } catch {}

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
