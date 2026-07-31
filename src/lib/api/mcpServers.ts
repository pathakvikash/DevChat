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

export function mcpServerNotFoundResponse() {
  return NextResponse.json({ error: "MCP server not found" }, { status: 404 });
}
