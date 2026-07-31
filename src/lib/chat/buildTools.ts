import { tool, type Tool } from "ai";
import { z } from "zod";
import { TOOL_REGISTRY, getSkill } from "@/lib/registry";
import { prisma } from "@/lib/db";
import { webSearch, formatSearchResults, type SearchProvider } from "@/lib/search";
import { listServerTools, callServerTool } from "@/lib/mcp/client";
import type { ToolExecutionContext } from "@/lib/registry/types";

export const BUILTIN_TOOL_IDS = [
  "executeCode",
  "webSearch",
  "rememberFact",
  "forgetFact",
  "createArtifact",
  "updateArtifact",
  "askClarification",
  "createTodo",
  "createTodos",
  "updateTodo",
  "currentTime",
  "calculator",
  "jsonExtract",
] as const;

export function resolveActiveToolIds(
  explicitToolIds: string[],
  skillIds: string[],
  kbId?: string | null,
): Set<string> {
  const active = new Set<string>(BUILTIN_TOOL_IDS);
  for (const id of explicitToolIds) active.add(id);
  for (const sid of skillIds) {
    const skill = getSkill(sid);
    if (!skill) continue;
    for (const tid of skill.toolIds) active.add(tid);
  }
  return active;
}

export interface BuildToolsOptions {
  activeToolIds: Set<string>;
  searchProvider: SearchProvider;
  conversationId?: string;
  userId: string;
}

/** Convert a JSON Schema object to a Zod schema (supports basic types). */
function jsonSchemaToZod(schema: any): z.ZodTypeAny {
  if (!schema) return z.any();

  if (schema.type === "string") {
    let s = z.string();
    if (schema.enum) s = z.enum(schema.enum as [string, ...string[]]) as any;
    return s;
  }
  if (schema.type === "number") return z.number();
  if (schema.type === "integer") return z.number().int();
  if (schema.type === "boolean") return z.boolean();
  if (schema.type === "array") {
    return z.array(jsonSchemaToZod(schema.items));
  }
  if (schema.type === "object" || schema.properties) {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [key, val] of Object.entries(schema.properties || {})) {
      shape[key] = jsonSchemaToZod(val);
    }
    return z.object(shape);
  }
  return z.any();
}

function mcpToolId(serverName: string, toolName: string): string {
  return `mcp_${serverName}_${toolName}`;
}

export async function buildTools({
  activeToolIds,
  searchProvider,
  conversationId,
  userId,
}: BuildToolsOptions): Promise<Record<string, Tool>> {
  const ctx: ToolExecutionContext = { conversationId };
  const aiTools: Record<string, Tool> = {};

  // ─── Load MCP tools from enabled servers ────────────────────────────────
  try {
    const servers = await (prisma as any).mcpServer.findMany({
      where: { enabled: true, userId },
    });
    for (const server of servers) {
      try {
        const tools = await listServerTools(server.id);
        for (const mcpTool of tools) {
          const id = mcpToolId(server.name, mcpTool.name);
          if (!activeToolIds.has(id)) continue;
          const zodSchema = jsonSchemaToZod(mcpTool.inputSchema);
          aiTools[id] = tool({
            description: mcpTool.description || `MCP tool: ${mcpTool.name} (${server.name})`,
            inputSchema: zodSchema as any,
            execute: async (args: Record<string, unknown>) => {
              const result = await callServerTool(server.id, mcpTool.name, args);
              const texts = result.content
                .filter((c: any) => c.type === "text")
                .map((c: any) => c.text)
                .join("\n");
              if (result.isError) return `Error: ${texts || "Tool call failed"}`;
              return texts || "(no output)";
            },
          });
        }
      } catch (err) {
        console.error(`[MCP] Failed to load tools from "${server.name}":`, err);
        await (prisma as any).mcpServer.update({
          where: { id: server.id },
          data: { errorMsg: err instanceof Error ? err.message : String(err) },
        });
      }
    }
  } catch (err) {
    console.error("[MCP] Failed to load MCP servers:", err);
  }

  // ─── Built-in tools ─────────────────────────────────────────────────────
  for (const toolId of activeToolIds) {
    if (aiTools[toolId]) continue; // skip MCP tools already added
    const def = TOOL_REGISTRY[toolId];
    if (!def) continue;
    if (toolId === "webSearch") {
      aiTools.webSearch = tool({
        description: def.modelDescription,
        inputSchema: def.inputSchema as any,
        execute: async ({ query }: { query: string }) => {
          const { results, usedProvider, warning } = await webSearch(query, searchProvider);
          const header = `[search via ${usedProvider}${warning ? ` — ${warning}` : ""}]`;
          if (results.length === 0) return `${header}\nNo results.`;
          return `${header}\n\n${formatSearchResults(results)}`;
        },
      });
      continue;
    }
    if (def.execute) {
      const userExecute = def.execute;
      aiTools[toolId] = tool({
        description: def.modelDescription,
        inputSchema: def.inputSchema as any,
        execute: async (input: any) => userExecute(input, ctx),
      });
    } else {
      aiTools[toolId] = tool({
        description: def.modelDescription,
        inputSchema: def.inputSchema as any,
      });
    }
  }

  if (activeToolIds.has("rememberFact")) {
    aiTools.rememberFact = tool({
      description: "Save a persistent fact about the user...",
      inputSchema: z.object({
        key: z.string().describe("Short snake_case identifier..."),
        value: z.string().describe("The fact itself, in one sentence."),
        category: z
          .enum(["profile", "preference", "project", "context"])
          .default("profile")
          .describe("profile=who they are, preference=how they want you to behave..."),
      }),
      execute: async ({ key, value, category }) => {
        const cleanKey = key.trim().slice(0, 80);
        if (!cleanKey) return "Error: key cannot be empty.";
        const m = await prisma.memory.upsert({
          where: { userId_key: { userId, key: cleanKey } },
          create: { userId, key: cleanKey, value: value.trim().slice(0, 2000), category: category || "profile" },
          update: { value: value.trim().slice(0, 2000), category: category || "profile" },
        });
        return `Saved memory [${m.category}] ${m.key} = "${m.value}"`;
      },
    });
  }

  if (activeToolIds.has("forgetFact")) {
    aiTools.forgetFact = tool({
      description: "Delete a stored memory by key...",
      inputSchema: z.object({
        key: z.string().describe("The exact key of the memory to delete."),
      }),
      execute: async ({ key }) => {
        try {
          await prisma.memory.delete({ where: { userId_key: { userId, key: key.trim() } } });
          return `Forgot memory: ${key}`;
        } catch (e: any) {
          if (e?.code === "P2025") return `No such memory: ${key}`;
          return `Error forgetting ${key}: ${e?.message || String(e)}`;
        }
      },
    });
  }

  return aiTools;
}

export type ToolSet = Awaited<ReturnType<typeof buildTools>>;
