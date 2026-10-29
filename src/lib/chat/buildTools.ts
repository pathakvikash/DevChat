import { tool, type Tool } from "ai";
import { z } from "zod";
import { TOOL_REGISTRY, getSkill } from "@/lib/registry";
import { prisma } from "@/lib/db";
import { webSearch, formatSearchResults, type SearchProvider } from "@/lib/search";
import { listServerTools, callServerTool } from "@/lib/mcp/client";
import type { ToolExecutionContext } from "@/lib/registry/types";
import { searchUserChats, readUserChat } from "@/lib/chatSearch";
import { budgetTokens } from "@/lib/chat/contextBudget";
import { quoteSearchResults } from "@/lib/chat/quotePastChat";
import type { AgentTarget } from "@/lib/chat/agentMessages";
import { MODE_POLICY, needsApproval, type ChatMode } from "@/lib/chat/modes";

export const BUILTIN_TOOL_IDS = [
  "executeCode",
  "webSearch",
  "rememberFact",
  "forgetFact",
  "searchChats",
  "readChat",
  "createArtifact",
  "updateArtifact",
  "askClarification",
  "createTodo",
  "createTodos",
  "updateTodo",
  "currentTime",
  "calculator",
  "jsonExtract",
  "sendToChat",
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

/** Chat and Plan are read-only; Ask and Agent also offer mutating tools. */
export type ToolMode = ChatMode;

export interface BuildToolsOptions {
  activeToolIds: Set<string>;
  searchProvider: SearchProvider;
  conversationId?: string;
  userId: string;
  /** Defaults to "agent" so server-side callers keep full capability. */
  mode?: ToolMode;
  /** The model's context window in tokens; `readChat` sizes its result from it. */
  contextWindow: number;
  /** Memory is off (temporary chat or the Memory toggle): no rememberFact / forgetFact. */
  memoryDisabled?: boolean;
  /** Chats the model may message (see sendToChatTargets). Empty: no sendToChat tool. */
  agentTargets?: AgentTarget[];
  /** Tools the user allowed for this chat in Ask mode ("Allow for this chat"). */
  allowedTools?: readonly string[];
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
  mode = "agent",
  contextWindow,
  memoryDisabled = false,
  agentTargets = [],
  allowedTools = [],
}: BuildToolsOptions): Promise<Record<string, Tool>> {
  const ctx: ToolExecutionContext = { conversationId };
  const aiTools: Record<string, Tool> = {};
  const allowMutating = MODE_POLICY[mode].mutating;
  const allowed = new Set(allowedTools);

  // ─── Load MCP tools from enabled servers ────────────────────────────────
  // MCP servers can do anything, so they count as mutating. Skipping the whole
  // block in chat mode also avoids pinging every configured server for nothing.
  try {
    const servers = allowMutating
      ? await (prisma as any).mcpServer.findMany({ where: { enabled: true, userId } })
      : [];
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
            needsApproval: needsApproval(mode, id, allowed),
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
    if (toolId === "sendToChat") continue; // offered below, only with targets
    const def = TOOL_REGISTRY[toolId];
    if (!def) continue;
    if (def.mutates && !allowMutating) continue;
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
        needsApproval: def.mutates ? needsApproval(mode, toolId, allowed) : undefined,
        execute: async (input: any) => userExecute(input, ctx),
      });
    } else {
      aiTools[toolId] = tool({
        description: def.modelDescription,
        inputSchema: def.inputSchema as any,
        needsApproval: def.mutates ? needsApproval(mode, toolId, allowed) : undefined,
      });
    }
  }

  // Browser-run like executeCode: the pane sends it. Offered only when another chat is open.
  if (agentTargets.length > 0) {
    const openChats = agentTargets.map((t) => `"${t.title}" (id ${t.id})`).join(", ");
    aiTools.sendToChat = tool({
      description: `${TOOL_REGISTRY.sendToChat.modelDescription}\nOpen chats: ${openChats}.`,
      inputSchema: TOOL_REGISTRY.sendToChat.inputSchema as any,
    });
  }

  if (allowMutating && !memoryDisabled && activeToolIds.has("rememberFact")) {
    aiTools.rememberFact = tool({
      description: "Save a persistent fact about the user...",
      needsApproval: needsApproval(mode, "rememberFact", allowed),
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

  if (allowMutating && !memoryDisabled && activeToolIds.has("forgetFact")) {
    aiTools.forgetFact = tool({
      description: "Delete a stored memory by key...",
      needsApproval: needsApproval(mode, "forgetFact", allowed),
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

  // Read-only, so offered in every mode.
  if (activeToolIds.has("searchChats")) {
    aiTools.searchChats = tool({
      description:
        "Search the user's OTHER past chats (not this one) by keyword. Use it when they refer to something discussed earlier, e.g. \"what did we decide about X last week\". Returns up to 5 chats with id, title, date and a snippet; pass an id to readChat for more.",
      inputSchema: z.object({
        query: z.string().min(2).describe("Keyword or phrase to look for in chat titles and messages."),
      }),
      // The card reads the structured results; the model only ever sees them framed as data.
      execute: async ({ query }) => {
        const hits = await searchUserChats(userId, query, { excludeId: conversationId });
        return { results: hits.map((h) => ({ ...h, updatedAt: h.updatedAt.toISOString() })) };
      },
      toModelOutput: ({ input, output }) => ({
        type: "text",
        value: quoteSearchResults(input.query, output.results),
      }),
    });
  }

  if (activeToolIds.has("readChat")) {
    aiTools.readChat = tool({
      description:
        "Read one of the user's past chats: its summary and most recent messages. Takes an id returned by searchChats.",
      inputSchema: z.object({
        id: z.string().describe("Chat id from searchChats."),
      }),
      execute: async ({ id }) =>
        (await readUserChat(userId, id, budgetTokens(contextWindow, 0.25, 6000))) ?? "Chat not found.",
    });
  }

  // Plan ends with this card. Like askClarification it has no execute: the browser answers it.
  if (MODE_POLICY[mode].planCard) {
    aiTools.presentPlan = tool({
      description: TOOL_REGISTRY.presentPlan.modelDescription,
      inputSchema: TOOL_REGISTRY.presentPlan.inputSchema as any,
    });
  }

  return aiTools;
}

export type ToolSet = Awaited<ReturnType<typeof buildTools>>;
