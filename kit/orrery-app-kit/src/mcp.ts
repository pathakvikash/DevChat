// Minimal MCP streamable-HTTP server (JSON responses, stateless). No SDK.
import { OrreryAuthError, verifyOrreryToken } from "./token";

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  inputSchema: Record<string, unknown>;
  /** Emitted as annotations.readOnlyHint. Orrery asks the user first for non-read-only tools. */
  readOnly: boolean;
  handler(args: Record<string, unknown>, ctx: { email: string }): unknown | Promise<unknown>;
}

export interface McpOptions {
  name: string;
  version: string;
  tools: ToolDef[];
  /** Throw OrreryAuthError to reject. Default: verify the Orrery token from env. */
  authenticate?: (req: Request) => { email: string } | Promise<{ email: string }>;
}

const PROTOCOL = "2025-03-26";

/** Reads ORRERY_APP_SECRET, ORRERY_APP_ID, ORRERY_ISSUER (default "orrery"). */
export function envAuthenticate(): (req: Request) => { email: string } {
  return (req) =>
    verifyOrreryToken(req.headers.get("authorization"), {
      secret: process.env.ORRERY_APP_SECRET ?? "",
      appId: process.env.ORRERY_APP_ID ?? "",
      issuer: process.env.ORRERY_ISSUER || "orrery",
    });
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const rpcErr = (id: unknown, code: number, message: string) => json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

export function createMcpHandler(o: McpOptions): (req: Request) => Promise<Response> {
  const authenticate = o.authenticate ?? envAuthenticate();
  const tools = new Map(o.tools.map((t) => [t.name, t]));
  return async (req) => {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
    let ctx: { email: string };
    try {
      ctx = await authenticate(req);
    } catch (e) {
      const status = e instanceof OrreryAuthError ? e.status : 401;
      return json({ error: e instanceof Error ? e.message : "unauthorized" }, status);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let msg: any;
    try {
      msg = await req.json();
    } catch {
      return rpcErr(null, -32700, "Parse error");
    }
    if (!msg || Array.isArray(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcErr(msg?.id, -32600, "Invalid Request");
    if (msg.id === undefined) return new Response(null, { status: 202 }); // notification
    switch (msg.method) {
      case "initialize":
        return json({
          jsonrpc: "2.0",
          id: msg.id,
          result: { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: o.name, version: o.version } },
        });
      case "ping":
        return json({ jsonrpc: "2.0", id: msg.id, result: {} });
      case "tools/list":
        return json({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            tools: o.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: t.readOnly } })),
          },
        });
      case "tools/call": {
        const tool = tools.get(msg.params?.name);
        if (!tool) return rpcErr(msg.id, -32602, `Unknown tool: ${msg.params?.name}`);
        try {
          const result = await tool.handler(msg.params?.arguments ?? {}, ctx);
          return json({ jsonrpc: "2.0", id: msg.id, result });
        } catch (e) {
          return json({ jsonrpc: "2.0", id: msg.id, result: { isError: true, content: [{ type: "text", text: e instanceof Error ? e.message : "tool failed" }] } });
        }
      }
      default:
        return rpcErr(msg.id, -32601, `Method not found: ${msg.method}`);
    }
  };
}

/** Next.js App Router: `export const { POST, GET } = nextRouteHandler(handler)`. */
export const nextRouteHandler = (handler: (req: Request) => Promise<Response>) => ({ POST: handler, GET: handler });

/** Express: `app.post("/api/mcp", expressMiddleware(handler))` (works with or without express.json()). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function expressMiddleware(handler: (req: Request) => Promise<Response>): (req: any, res: any) => Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (req: any, res: any) => {
    const url = `${req.protocol ?? "http"}://${req.get?.("host") ?? "localhost"}${req.originalUrl ?? req.url}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    let body: string | undefined;
    if (req.method === "POST") {
      if (typeof req.body === "string") body = req.body;
      else if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) body = JSON.stringify(req.body);
      else {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c);
        body = Buffer.concat(chunks).toString("utf8");
      }
    }
    const r = await handler(new Request(url, { method: req.method, headers, body }));
    res.status(r.status);
    r.headers.forEach((v, k) => res.setHeader(k, v));
    res.send(await r.text());
  };
}
