import { prisma } from "@/lib/db";
import { canUseHostTools, HOST_TOOLS_REFUSED } from "@/lib/hostAccess";
import { callServerTool, listServerTools } from "@/lib/mcp/client";
import { OUTPUT_CAP_BYTES } from "../catalog";
import { renderTemplate } from "../template";
import type { CardImpl } from "./index";

/** The user's own enabled server, or null. Another user's or a disabled one is refused (10.1). */
export async function ownedEnabledServer(userId: string, serverId: string) {
  if (!serverId) return null;
  return prisma.mcpServer.findFirst({ where: { id: serverId, userId, enabled: true }, select: { id: true, name: true } });
}

/** MCP tools can act outside DevChat, so they belong to the server's owner (10.1). Checked again before every call. */
export async function requireOwner(userId: string) {
  if (!(await canUseHostTools(userId))) throw new Error(HOST_TOOLS_REFUSED);
}

export const mcpToolCard: CardImpl = {
  async run(c) {
    const { config, tctx, userId } = c;
    await requireOwner(userId);
    const server = await ownedEnabledServer(userId, String(config.serverId ?? ""));
    if (!server) throw new Error("That MCP server isn't available: it is missing, turned off, or not yours");
    const tool = String(config.tool ?? "").trim();
    if (!tool) throw new Error("Pick a tool");
    // Only a tool the server lists can be called, whatever the saved graph says.
    const offered = await listServerTools(server.id);
    if (!offered.some((t) => t.name === tool)) throw new Error(`${server.name} has no tool called "${tool}"`);

    const warnings: string[] = [];
    const args: Record<string, unknown> = {};
    for (const [key, template] of Object.entries((config.args as Record<string, string>) ?? {})) {
      const r = renderTemplate(String(template), tctx);
      args[key] = r.value;
      for (const m of r.missing) if (warnings.length < 10) warnings.push(`{{${m}}} was empty`);
    }

    const result = await callServerTool(server.id, tool, args);
    const text = result.content
      .filter((p): p is { type: "text"; text: string } => !!p && (p as { type?: unknown }).type === "text" && typeof (p as { text?: unknown }).text === "string")
      .map((p) => p.text)
      .join("\n");
    if (result.isError) throw new Error(text.slice(0, 500) || "The tool call failed");
    const capped = text.slice(0, OUTPUT_CAP_BYTES);
    if (capped.length < text.length) warnings.push("The tool's output was cut");
    let data: unknown;
    try {
      data = JSON.parse(capped);
    } catch {
      // plain text: no data
    }
    return { output: data === undefined ? { text: capped } : { text: capped, data }, warnings };
  },
};
