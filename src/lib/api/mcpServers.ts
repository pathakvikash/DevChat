import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import type { McpServer } from "@prisma/client";

/** The `McpServer` Prisma delegate, in one place so every route imports it the same way. */
export function getPrismaMcp() {
  return prisma.mcpServer;
}

export type McpServerLookupResult =
  | { ok: true; server: McpServer }
  | { ok: false };

/** Looks up an MCP server by id, scoped to its owning user. */
export async function findMcpServer(id: string, userId: string): Promise<McpServerLookupResult> {
  const server = await prisma.mcpServer.findUnique({ where: { id } });
  if (!server || server.userId !== userId) return { ok: false };
  return { ok: true, server };
}

const SECRET_KEYS = ["apiKey", "clientSecret"] as const;

/** What the browser may see of a server's auth: the settings without secrets, and which secrets are set. */
export function redactAuthConfig(raw: string | null | undefined): { authConfig?: string; hasApiKey: boolean; hasClientSecret: boolean } {
  let cfg: Record<string, unknown> = {};
  try {
    cfg = raw ? JSON.parse(raw) : {};
  } catch {}
  const has = { hasApiKey: !!cfg.apiKey, hasClientSecret: !!cfg.clientSecret };
  for (const k of SECRET_KEYS) delete cfg[k];
  return { authConfig: Object.keys(cfg).length ? JSON.stringify(cfg) : undefined, ...has };
}

/** An edit's auth settings on top of the stored ones. A secret left empty keeps the stored one. */
export function mergeAuthConfig(stored: string | null | undefined, incoming: Record<string, unknown>, authType?: string): string {
  let cfg: Record<string, unknown> = {};
  try {
    cfg = stored ? JSON.parse(stored) : {};
  } catch {}
  const next: Record<string, unknown> = { ...cfg };
  for (const [k, v] of Object.entries(incoming)) {
    if (v === null) delete next[k]; // an explicit null removes the key
    else if ((SECRET_KEYS as readonly string[]).includes(k) && !v) continue; // an empty secret keeps the stored one
    else next[k] = v;
  }
  // A secret the auth type doesn't use goes away when the type changes.
  if (authType !== undefined) {
    if (authType !== "apikey") delete next.apiKey;
    if (authType !== "oauth2") delete next.clientSecret;
  }
  return JSON.stringify(next);
}

export function mcpServerNotFoundResponse() {
  return NextResponse.json({ error: "MCP server not found" }, { status: 404 });
}
