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
import {
  applySubAgentProgress,
  finishSubAgentOutput,
  runSubAgent,
  startSubAgentOutput,
  subAgentModelOutput,
  type RunSubAgentOptions,
  type SubAgentOutput,
  type SubAgentProgress,
  type SubAgentResult,
} from "@/lib/chat/subAgent";
import { saveUserMessage } from "@/lib/chat/saveUserMessage";
import type { ModelConfig } from "@/lib/models";

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

/** Tools a read-only (Ask or Plan) helper must not get: no approval can be asked inside a sub-agent. */
const MUTATING_TOOL_IDS = new Set([
  "rememberFact",
  "forgetFact",
  "createArtifact",
  "updateArtifact",
  "createTodo",
  "createTodos",
  "updateTodo",
]);
const isMutatingTool = (id: string) => MUTATING_TOOL_IDS.has(id) || id.startsWith("mcp_");

/** Only a main chat with tools can start helpers. Side chats and helpers never get `runAgent`. */
export function canStartSubAgents(kind: string | undefined, useTools: boolean): boolean {
  return useTools && kind === "main";
}

export interface SubAgentToolOptions {
  userId: string;
  /** The parent conversation. Each run is saved as its child (`kind: "subagent"`). */
  parentId: string;
  /** The served model, so a helper uses the same model and fallback as its parent. */
  model: ModelConfig;
  mode: ToolMode;
  workingFolder?: string | null;
  providerOptions?: RunSubAgentOptions["providerOptions"];
  /** Helpers allowed to run in one step: 3 for API models, 1 for CLI models. */
  maxParallel: number;
}

async function startSubAgentChild(opts: SubAgentToolOptions, title: string, task: string): Promise<string> {
  const child = await prisma.conversation.create({
    data: {
      userId: opts.userId,
      parentId: opts.parentId,
      kind: "subagent",
      title,
      model: opts.model.id,
      workingFolder: opts.workingFolder ?? null,
    },
    select: { id: true },
  });
  await saveUserMessage({ conversationId: child.id, text: task, parts: [{ type: "text", text: task }] });
  return child.id;
}

async function finishSubAgentChild(childId: string, modelId: string, result: SubAgentResult): Promise<void> {
  const reply = result.transcript[1];
  const { inputTokens, outputTokens } = result.usage;
  if (reply?.parts.length) {
    await prisma.message.create({
      data: {
        conversationId: childId,
        role: "assistant",
        content: result.report,
        parts: JSON.stringify(reply.parts),
        inputTokens,
        outputTokens,
        model: modelId,
      },
    });
  }
  await prisma.conversation.update({
    where: { id: childId },
    data: { totalTokens: { increment: inputTokens + outputTokens } },
  });
}

/**
 * The `runAgent` tool: one helper per call, run to completion, with progress as preliminary
 * outputs. Built from the parent's tools after `buildTools`, so it sees the same set.
 */
export function runAgentTool(parentTools: Record<string, Tool>, opts: SubAgentToolOptions): Tool {
  const helperTools = Object.fromEntries(
    Object.entries(parentTools).filter(([id]) => opts.mode === "agent" || !isMutatingTool(id)),
  );
  let running = 0;

  return tool({
    description:
      "Start a helper that does one self-contained job alone (for example reading and summarising several files, or researching one question) and returns its written report. The helper sees only the task you write, so put every fact it needs in the task. Use it for work that would take many steps. Up to 3 helpers can run in one reply.",
    inputSchema: z.object({
      task: z.string().min(1).max(8000).describe("The whole job for the helper, with the facts it needs."),
      title: z.string().max(60).optional().describe("Short name for the card, e.g. 'Read the API docs'."),
    }),
    execute: async function* ({ task, title }, { abortSignal }) {
      // The parent request's signal (Stop). The SDK types it as optional.
      const signal = abortSignal ?? new AbortController().signal;
      const startedAt = Date.now();
      const label = title?.trim() || task.slice(0, 60);
      // Checked before any await, so the count is exact when calls in one step start together.
      if (running >= opts.maxParallel) {
        yield {
          ...startSubAgentOutput(label, startedAt),
          status: "error",
          endedAt: startedAt,
          error: `Only ${opts.maxParallel} sub-agent${opts.maxParallel === 1 ? " runs" : "s run"} at once here. Wait for the others, then ask again.`,
        } satisfies SubAgentOutput;
        return;
      }
      running++;
      try {
        let childId: string;
        try {
          childId = await startSubAgentChild(opts, label, task);
        } catch (err) {
          console.error("[subagent] could not save the child conversation:", err);
          yield {
            ...startSubAgentOutput(label, startedAt),
            status: "error",
            endedAt: Date.now(),
            error: "Could not start the sub-agent.",
          } satisfies SubAgentOutput;
          return;
        }

        let out = startSubAgentOutput(label, startedAt, childId);
        let dirty = true;
        let wake: (() => void) | undefined;
        let settled = false;
        const onProgress = (event: SubAgentProgress) => {
          out = applySubAgentProgress(out, event);
          dirty = true;
          wake?.();
        };
        // The save runs with the run, not in this generator, so it happens even if the consumer stops reading.
        const run = runSubAgent({
          brief: task,
          model: opts.model,
          mode: opts.mode,
          workingFolder: opts.workingFolder,
          tools: helperTools,
          providerOptions: opts.providerOptions,
          abortSignal: signal,
          onProgress,
        })
          .catch(
            (err): SubAgentResult => ({
              status: "error",
              report: "",
              steps: 0,
              usage: { inputTokens: 0, outputTokens: 0 },
              transcript: [],
              error: err instanceof Error ? err.message : String(err),
            }),
          )
          .then(async (result) => {
            settled = true;
            await finishSubAgentChild(childId, opts.model.id, result).catch((err) =>
              console.error("[subagent] could not save the run:", err),
            );
            wake?.();
            return result;
          });

        while (!settled) {
          if (!dirty) await new Promise<void>((resolve) => (wake = resolve));
          wake = undefined;
          if (dirty) {
            dirty = false;
            yield out;
          }
        }
        const result = await run;
        yield finishSubAgentOutput(out, result, Date.now());
      } finally {
        running--;
      }
    },
    toModelOutput: ({ output }) => subAgentModelOutput(output as SubAgentOutput),
  });
}
