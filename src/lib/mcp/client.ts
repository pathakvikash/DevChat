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

  if (authToken) {
    try {
      const token = JSON.parse(authToken);
      if (token.access_token) headers.Authorization = `Bearer ${token.access_token}`;
    } catch {}
  }

  return headers;
}

export async function connectToServer(serverId: string): Promise<void> {
  const existing = clientCache.get(serverId);
  if (existing) {
    try { await existing.client.ping(); return; } catch {
      clientCache.delete(serverId);
    }
  }

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
  clientCache.set(serverId, { client, transport });
}

export async function disconnectFromServer(serverId: string): Promise<void> {
  const entry = clientCache.get(serverId);
  if (!entry) return;
  try { await entry.transport.close(); } catch {}
  try { await entry.client.close(); } catch {}
  clientCache.delete(serverId);
}

export async function listServerTools(serverId: string): Promise<McpTool[]> {
  await connectToServer(serverId);
  const entry = clientCache.get(serverId);
  if (!entry) throw new Error(`MCP server "${serverId}" not connected`);

  const result = await entry.client.listTools();
  return result.tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

export async function callServerTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpCallResult> {
  await connectToServer(serverId);
  const entry = clientCache.get(serverId);
  if (!entry) throw new Error(`MCP server "${serverId}" not connected`);

  const result = await entry.client.callTool({
    name: toolName,
    arguments: args,
  });

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

export function clearClientCache(): void {
  clientCache.clear();
}
