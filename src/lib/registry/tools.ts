import { z } from "zod";
import type { ToolDefinition } from "./types";
import { prisma } from "@/lib/db";
import { embed, scoreDocumentChunks, type ScoredChunk } from "@/lib/rag";
import { evaluate } from "mathjs";

function isPrivateUrl(url: string): boolean {
  const privatePatterns = [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "[::1]",
    "[::]",
    "10.",
    "172.16.",
    "172.17.",
    "192.168.",
    "169.254.",
  ];
  const hostname = url.split("/")[2]?.split(":")[0]?.toLowerCase() || "";
  return privatePatterns.some((p) => hostname.startsWith(p));
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 *  HOW TO ADD A NEW TOOL
 * ─────────────────────────────────────────────────────────────────────────
 *  1. Add an entry below with a unique `id`, schema, and (usually) execute.
 *  2. Save the file. The /api/registry endpoint picks it up automatically.
 *  3. Open the Advanced Settings drawer in any chat and toggle it on.
 *
 *  Server-side tool: provide `execute(input)` returning a string.
 *  Client-side tool: omit `execute`, then handle the call in
 *    app/c/[id]/page.tsx's `onToolCall` callback (like `executeCode`).
 * ─────────────────────────────────────────────────────────────────────────
 */
export const TOOL_REGISTRY: Record<string, ToolDefinition> = {
  // ─── ARTIFACTS ──────────────────────────────────────────────────────────
  createArtifact: {
    id: "createArtifact",
    mutates: true,
    name: "Create Artifact",
    description:
      "Create an artifact — a reusable document, code file, report, table, or other structured content that will be shown in a side panel.",
    modelDescription:
      "Create an artifact — a reusable document, code file, report, table, or other structured content that will be shown in a side panel. Use this INSTEAD of printing large code blocks or documents in chat. The artifact is saved and can be updated later.",
    category: "Utility",
    internal: true,
    inputSchema: z.object({
      type: z.enum(["code", "document", "report", "table", "svg", "mermaid", "html"]),
      title: z.string().min(1).describe("Descriptive title for the artifact"),
      content: z.string().min(1).describe("The full content of the artifact"),
      language: z
        .string()
        .optional()
        .describe("Programming language (for code type)"),
    }),
    execute: async ({ type, title, content, language }, ctx) => {
      try {
        if (!ctx.conversationId) return "Error: no active conversation.";
        const artifact = await prisma.artifact.create({
          data: { conversationId: ctx.conversationId, type, title, content },
        });
        return `Artifact created: ${artifact.id} (v${artifact.version}) — "${artifact.title}"`;
      } catch (e: any) {
        return `Error creating artifact: ${e?.message || String(e)}`;
      }
    },
    enabledByDefault: true,
    builtIn: true,
  },

  updateArtifact: {
    id: "updateArtifact",
    mutates: true,
    name: "Update Artifact",
    description:
      "Update an existing artifact. The artifact will be shown in the side panel with the updated content.",
    modelDescription:
      "Update an existing artifact. The artifact will be shown in the side panel with the updated content.",
    category: "Utility",
    internal: true,
    inputSchema: z.object({
      artifactId: z.string().min(1),
      content: z.string().optional(),
      title: z.string().optional(),
    }),
    execute: async ({ artifactId, content, title }, ctx) => {
      try {
        const existing = await prisma.artifact.findUnique({
          where: { id: artifactId },
        });
        if (!existing) return `Error: artifact ${artifactId} not found.`;
        const version =
          content !== undefined && content !== existing.content
            ? existing.version + 1
            : existing.version;
        const updated = await prisma.artifact.update({
          where: { id: artifactId },
          data: {
            ...(title !== undefined && { title }),
            ...(content !== undefined && { content }),
            version,
          },
        });
        return `Artifact updated: ${updated.id} (v${updated.version}) — "${updated.title}"`;
      } catch (e: any) {
        return `Error updating artifact: ${e?.message || String(e)}`;
      }
    },
    enabledByDefault: true,
    builtIn: true,
  },

  // ─── BUILT-IN, ALWAYS-ON ──────────────────────────────────────────────
  executeCode: {
    id: "executeCode",
    name: "Execute Code (sandbox)",
    description: "Run Python (Pyodide) or JavaScript in a browser sandbox.",
    modelDescription:
      "Execute Python or JavaScript code in a secure browser sandbox. Python runs in Pyodide (numpy/pandas pre-loaded; other PyPI via `import micropip; await micropip.install('pkg')`). JavaScript runs in a sandboxed iframe (5s timeout). Returns stdout/stderr/return value.",
    category: "Code",
    internal: true,
    inputSchema: z.object({
      language: z.enum(["python", "javascript"]),
      code: z.string().describe("Self-contained code. Use print() / console.log() for visible output."),
    }),
    // No execute — client-side via onToolCall in app/c/[id]/page.tsx.
    enabledByDefault: true,
    builtIn: true,
  },

  webSearch: {
    id: "webSearch",
    name: "Web Search",
    description: "Search the live web (DuckDuckGo free, Tavily if key set).",
    modelDescription:
      "Search the live web for current information. Use for news, prices, recent events, or anything time-sensitive. Returns top 5 results with title, URL, snippet.",
    category: "Web",
    inputSchema: z.object({
      query: z.string().describe("Specific, keyword-driven search query."),
    }),
    // execute is dynamic (uses per-request provider) so it's wired in the
    // chat route. Marker tool here for the registry UI only.
    enabledByDefault: true,
    builtIn: true,
  },

  // ─── EXTRA SHIPPING TOOLS (toggleable) ─────────────────────────────────
  fetchUrl: {
    id: "fetchUrl",
    name: "Fetch URL",
    description: "Fetch a web page and return its readable text content.",
    modelDescription:
      "Fetch a single URL and return up to 8000 characters of the readable text (HTML stripped). Use after webSearch when you need the full content of a specific page, or when the user gives you a URL.",
    category: "Web",
    inputSchema: z.object({
      url: z.string().describe("Full URL starting with http:// or https://"),
    }),
    execute: async ({ url }) => {
      try {
        const blockedProtocols = ["file:", "ftp:", "dict:", "gopher:"];
        if (blockedProtocols.some((p) => url.toLowerCase().startsWith(p))) {
          return `Error: ${url.split(":")[0]}: protocol is not allowed.`;
        }
        if (isPrivateUrl(url)) {
          return `Error: access to private/internal URLs is not allowed.`;
        }
        const u = new URL(url);
        if (!/^https?:$/.test(u.protocol)) {
          return `Error: only http/https URLs allowed. Got: ${u.protocol}`;
        }
        const res = await fetch(u.toString(), {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; VAS/1.0; +https://github.com/anthropics/claude-code)",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          // 10s server-side timeout via AbortSignal
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return `HTTP ${res.status} ${res.statusText} for ${url}`;
        const ctype = res.headers.get("content-type") || "";
        const raw = await res.text();
        if (ctype.includes("application/json")) {
          return raw.slice(0, 8000);
        }
        // strip script/style + tags → readable text
        const text = raw
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<!--[\s\S]*?-->/g, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/\s+/g, " ")
          .trim();
        const truncated = text.length > 8000;
        return (
          (truncated ? text.slice(0, 8000) + "\n…[truncated]" : text) ||
          "(empty page)"
        );
      } catch (e: any) {
        return `Error fetching ${url}: ${e?.message || String(e)}`;
      }
    },
  },

  currentTime: {
    id: "currentTime",
    name: "Current Time",
    description: "Return current date/time in ISO 8601 + relative format.",
    modelDescription:
      "Get the current date and time on the server. ALWAYS call this tool when the user asks 'what time is it', 'what's today's date', 'current date', 'current time', or anything time-relative (e.g. 'is it still morning?', 'how long until Friday?'). Do NOT use executeCode / Python's datetime for this — this tool is faster, more reliable, and handles timezones. Returns ISO 8601 + a localized 'dateStyle: full, timeStyle: long' string. Pass an IANA `timezone` (e.g. 'America/Los_Angeles') if the user specified one; otherwise omit it for server local.",
    category: "Utility",
    internal: true,
    inputSchema: z.object({
      timezone: z
        .string()
        .optional()
        .describe("IANA timezone (e.g. 'America/Los_Angeles'). Default: server local."),
    }),
    execute: async ({ timezone }) => {
      const now = new Date();
      const opts: Intl.DateTimeFormatOptions = {
        dateStyle: "full",
        timeStyle: "long",
        timeZone: timezone || undefined,
      };
      try {
        const formatted = new Intl.DateTimeFormat("en-US", opts).format(now);
        return `ISO: ${now.toISOString()}\nLocal (${timezone || "server"}): ${formatted}`;
      } catch (e: any) {
        return `ISO: ${now.toISOString()}\n(Invalid timezone '${timezone}': ${e.message})`;
      }
    },
  },

  calculator: {
    id: "calculator",
    name: "Calculator",
    description: "Evaluate a math expression. Safe arithmetic only.",
    modelDescription:
      "Evaluate a math expression. Supports +, -, *, /, %, **, parentheses, and Math.* functions (sqrt, sin, log, etc.). For complex programs prefer executeCode.",
    category: "Math",
    internal: true,
    inputSchema: z.object({
      expression: z
        .string()
        .describe("A math expression, e.g. '2 * (3 + 4) ** 2' or 'Math.sqrt(625)'."),
    }),
    execute: async ({ expression }) => {
      try {
        const result = evaluate(expression);
        return `= ${result}`;
      } catch (e: any) {
        return `Error: ${e?.message || String(e)}`;
      }
    },
  },

  jsonExtract: {
    id: "jsonExtract",
    name: "JSON Extract",
    description: "Parse a JSON string and read a JSONPath-like dotted key.",
    modelDescription:
      "Parse a JSON string and extract a value at a dotted path. Path supports dots and [N] array indexing, e.g. 'users[0].email'. Returns the value (as JSON) or an error.",
    category: "Data",
    internal: true,
    inputSchema: z.object({
      json: z.string().describe("Raw JSON string to parse."),
      path: z
        .string()
        .describe("Dotted path. Examples: 'foo.bar', 'users[2].name', '' (whole doc)"),
    }),
    execute: async ({ json, path }) => {
      let data: any;
      try {
        data = JSON.parse(json);
      } catch (e: any) {
        return `Error parsing JSON: ${e.message}`;
      }
      if (!path) return JSON.stringify(data, null, 2);
      const tokens = path
        .replace(/\[(\d+)\]/g, ".$1")
        .split(".")
        .filter(Boolean);
      let cur: any = data;
      for (const t of tokens) {
        if (cur == null) return `Error: path '${path}' hit null at '${t}'`;
        cur = cur[t];
      }
      return cur === undefined
        ? `(undefined at '${path}')`
        : typeof cur === "string"
          ? cur
          : JSON.stringify(cur, null, 2);
    },
  },

  // ─── CLARIFICATION (always on) ────────────────────────────────────────
  askClarification: {
    id: "askClarification",
    name: "Ask Clarification",
    description: "Ask the user a follow-up question when their request is ambiguous or incomplete.",
    modelDescription:
      "Ask the user a follow-up question when their request is ambiguous, incomplete, or has multiple valid interpretations. Call this BEFORE executing other tools if you need more information. Choose the most appropriate type: 'single' (one choice from options) when possible for fastest response, 'multi' (select multiple from options) when several may apply, 'text' (free-form input) when options are unpredictable. You can mark one option as 'recommended' for single type. Ask one question at a time — call again if you need more. If enough information is available, proceed without calling this tool.",
    category: "Utility",
    internal: true,
    inputSchema: z.object({
      question: z.string().describe("The question to ask the user."),
      type: z
        .enum(["single", "multi", "text"])
        .describe("single=one choice from options, multi=select multiple, text=free-form text"),
      options: z
        .array(z.string())
        .optional()
        .describe("For single/multi choice, the possible answers."),
      recommended: z
        .string()
        .optional()
        .describe("The recommended default option for single type."),
    }),
    enabledByDefault: true,
    builtIn: true,
  },

  searchKnowledgeBase: {
    id: "searchKnowledgeBase",
    name: "Search Knowledge Base",
    description: "Semantic search over the active conversation's knowledge base (RAG).",
    modelDescription:
      "Search the knowledge base (KB) attached to the current conversation using semantic similarity. YOU MUST CALL THIS TOOL — do not just describe it or say you 'will' call it. The user CANNOT see documents you don't retrieve. Call it as your FIRST action whenever: the user mentions their documents, files, KB, notes, uploads, or anything they 'added'; asks 'what's in', 'look up', 'find in the docs', 'check the file', 'search the kb', 'summarize the doc'; references earlier retrieved content ('that section', 'the first chunk'); or asks any domain question the KB probably covers. Example: user says 'check the daily task file' → you call `searchKnowledgeBase({ query: 'daily task implementation' })` IMMEDIATELY, then summarize the result with `[source: filename#chunkN]` citations. If the tool returns 'No knowledge base attached', STOP — tell the user to open Model Settings and pick a KB.\n\nCOMPLETION REQUIREMENT (MANDATORY): After the tool returns its chunks, you MUST write a complete, detailed answer that cites the sources in the `[source: filename#chunkN | score=X.XXX]` format. Do NOT stop after just a few words like 'Based on the…' or 'According to…'. Write at least 2–3 complete sentences summarizing what each cited chunk actually says and how it answers the user's question. A tool call is the MIDDLE of your turn, not the end. A response shorter than ~40 words after this tool is a bug — keep writing until the user has a usable answer.",
    category: "Knowledge",
    inputSchema: z.object({
      query: z
        .string()
        .describe("Natural-language search query. Rephrase the user's question into a keyword-rich form for better embedding match. Example: 'daily task implementation steps' or 'project requirements design'."),
      topK: z
        .number()
        .int()
        .min(1)
        .max(20)
        .describe("How many chunks to return. 5 is usually right. Use 10-15 for broad questions, 2-3 for specific lookups."),
    }),
    execute: async ({ query, topK }, ctx) => {
      try {
        if (!ctx.conversationId) {
          return "No active conversation. The knowledge base is per-conversation.";
        }
        const conv = await prisma.conversation.findUnique({
          where: { id: ctx.conversationId },
          select: { kbId: true },
        });
        if (!conv?.kbId) {
          return "No knowledge base attached to this conversation. Tell the user to open Model Settings and pick a KB from the Knowledge Base dropdown, then ask their question again.";
        }

        const queryEmb = await embed(query);
        const documents = await prisma.document.findMany({
          where: { kbId: conv.kbId },
          select: { id: true, filename: true, chunks: true },
        });

        if (documents.length === 0) {
          return "The knowledge base is empty. Tell the user to upload documents at /kb.";
        }

        const scored: ScoredChunk[] = [];
        for (const doc of documents) {
          try {
            scored.push(...scoreDocumentChunks(doc, queryEmb));
          } catch {
            return `Error: document '${doc.filename}' has malformed chunk data.`;
          }
        }

        if (scored.length === 0) {
          return "No embedded chunks found. The documents may not have been indexed — try re-uploading.";
        }

        return scored
          .sort((a, b) => b.score - a.score)
          .slice(0, topK)
          .map((c) => `[source: ${c.source} | score=${c.score.toFixed(3)}]\n${c.text}`)
          .join("\n\n---\n\n");
      } catch (err) {
        console.error("[searchKnowledgeBase] error:", err);
        return `Error searching knowledge base: ${(err as Error).message || String(err)}. Tell the user something went wrong and to try again.`;
      }
    },
  },
  // ─── TODOS ──────────────────────────────────────────────────────────────
  createTodo: {
    id: "createTodo",
    mutates: true,
    name: "Create Todo",
    description: "Create a todo item for the current conversation.",
    modelDescription:
      "Create a todo item to track a task that needs to be done. Use this when you are working on a complex multi-step task — ALWAYS create todos to track progress. Each step of a multi-step task should get its own todo. Re-create all existing todos if the user asks you to plan something new.",
    category: "Utility",
    internal: true,
    inputSchema: z.object({
      title: z.string().min(1).describe("Short actionable title for the todo (e.g. 'Implement login API')"),
      description: z.string().optional().describe("Optional longer description or details"),
      priority: z.enum(["low", "medium", "high"]).default("medium").describe("Priority level"),
    }),
    execute: async ({ title, description, priority }, ctx) => {
      if (!ctx.conversationId) return "Error: no active conversation.";
      try {
        const todo = await prisma.todo.create({
          data: { conversationId: ctx.conversationId, title, description, priority },
        });
        return `Todo created: ${todo.id} — "${todo.title}"`;
      } catch (e: any) {
        return `Error creating todo: ${e?.message || String(e)}`;
      }
    },
    enabledByDefault: true,
    builtIn: true,
  },

  updateTodo: {
    id: "updateTodo",
    mutates: true,
    name: "Update Todo",
    description: "Update a todo item's status.",
    modelDescription:
      "Update a todo's status. Use when a task is done, in progress, or cancelled. Always mark as 'done' when you finish a task, 'in_progress' when actively working on it, or 'cancelled' if no longer needed.",
    category: "Utility",
    internal: true,
    inputSchema: z.object({
      todoId: z.string().min(1).describe("The id of the todo to update"),
      status: z.enum(["pending", "in_progress", "done", "cancelled"]).describe("New status — 'done' when complete, 'in_progress' when actively working"),
    }),
    execute: async ({ todoId, status }, ctx) => {
      try {
        const existing = await prisma.todo.findUnique({ where: { id: todoId } });
        if (!existing) return `Error: todo ${todoId} not found.`;
        await prisma.todo.update({
          where: { id: todoId },
          data: { status },
        });
        return `Todo updated: ${todoId} → ${status}`;
      } catch (e: any) {
        return `Error updating todo: ${e?.message || String(e)}`;
      }
    },
    enabledByDefault: true,
    builtIn: true,
  },

  createTodos: {
    id: "createTodos",
    mutates: true,
    name: "Create Multiple Todos",
    description: "Create multiple todo items at once for the current conversation.",
    modelDescription:
      "Create MULTIPLE todo items in a single call. Use this INSTEAD of calling createTodo repeatedly. When the user asks you to plan a multi-step task, call this once with ALL the steps. Each title should be a short, actionable description of one step. The todos are created atomically in a single transaction.",
    category: "Utility",
    internal: true,
    inputSchema: z.object({
      todos: z
        .array(
          z.object({
            title: z
              .string()
              .min(1)
              .describe("Short actionable title (e.g. 'Implement login API')"),
            description: z
              .string()
              .optional()
              .describe("Optional longer description"),
            priority: z
              .enum(["low", "medium", "high"])
              .default("medium")
              .describe("Priority level"),
          }),
        )
        .min(1)
        .max(20)
        .describe("Array of todos to create. Pass ALL steps at once."),
    }),
    execute: async ({ todos }, ctx) => {
      if (!ctx.conversationId) return "Error: no active conversation.";
      const convId = ctx.conversationId;
      try {
        const created = await prisma.$transaction(
          todos.map((t: any) =>
            prisma.todo.create({
              data: {
                conversationId: convId!,
                title: t.title,
                description: t.description || null,
                priority: t.priority || "medium",
              },
            }),
          ),
        );
        const summary = created
          .map((t: any) => `${t.id} — "${t.title}"`)
          .join("; ");
        return `Created ${created.length} todos: ${summary}`;
      } catch (e: any) {
        return `Error creating todos: ${e?.message || String(e)}`;
      }
    },
    enabledByDefault: true,
    builtIn: true,
  },
};

export function listTools(): ToolDefinition[] {
  return Object.values(TOOL_REGISTRY);
}

export function getTool(id: string): ToolDefinition | undefined {
  return TOOL_REGISTRY[id];
}
