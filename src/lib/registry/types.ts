import type { z } from "zod";

/**
 * Per-request context passed to server-side `execute` functions. Lets
 * tools that need request-scoped state (e.g. the active conversation id)
 * stay declarative in the registry instead of capturing variables.
 */
export interface ToolExecutionContext {
  /** Active conversation id, if any. Tools that scope to a conversation read this. */
  conversationId?: string;
}

/**
 * A tool the model can call. Two flavors:
 *
 * 1. **Server-side** — provide `execute`. Runs inside the Next.js API route.
 *    Best for HTTP calls, file reads, anything Node can do.
 *
 * 2. **Client-side** — omit `execute` and instead handle it in
 *    `useChat({ onToolCall })`. Best for browser-only things (Pyodide,
 *    DOM access, localStorage). The built-in `executeCode` works this way.
 */
export interface ToolDefinition {
  /** Unique stable id. Used in API calls and persistence. Keep it kebab/camel and stable. */
  id: string;
  /** Display name (for the UI). */
  name: string;
  /** Short one-liner shown in the UI. */
  description: string;
  /** Full description shown to the MODEL — be specific about when/how to call. */
  modelDescription: string;
  /** Logical group for the UI (e.g. "Web", "Data", "Math"). */
  category: string;
  /** Zod schema for the tool input. */
  inputSchema: z.ZodTypeAny;
  /**
   * If present, the tool runs server-side via this function.
   * If absent, the tool is delivered to the client (see useChat.onToolCall).
   * `ctx` carries per-request state (e.g. active conversation id).
   */
  execute?: (input: any, ctx: ToolExecutionContext) => Promise<string>;
  /** Default state — whether this tool is enabled when a new conversation starts. */
  enabledByDefault?: boolean;
  /** Mark as built-in so the UI can label it differently. */
  builtIn?: boolean;
  /** Internal tools are always available to the model and hidden from the UI toggle list. */
  internal?: boolean;
}

/**
 * A skill = a prompt fragment + a set of tools auto-enabled together.
 * Think "Data Analyst mode" or "Research mode".
 */
export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  /** Appended to the system prompt when the skill is on. */
  systemPrompt: string;
  /** Tool ids that get auto-enabled when this skill is on. */
  toolIds: string[];
}
