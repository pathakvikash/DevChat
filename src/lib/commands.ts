/**
 * Slash-command registry for the chat input. Two kinds:
 *
 *  - "transform": a pure rewrite of the user's message text before it's sent
 *    to the model (e.g. /think, /plan, /loop). No side effects — lives here.
 *  - "action": a side effect handled by the conversation page (e.g. /compress,
 *    /title). The registry only carries metadata + an `action` id;
 *    the page maps that id to a handler.
 *
 * This module is the single source of truth for both the autocomplete popover
 * and the dispatcher, so the two never drift.
 */

export type CommandKind = "transform" | "action";

export interface SlashCommand {
  name: string;
  aliases?: string[];
  description: string;
  /** Shown in the popover, e.g. "/plan <task>". */
  usage: string;
  kind: CommandKind;
  /** transform: rewrite the message text. `arg` is everything after the command. */
  transform?: (arg: string) => string;
  /** action: id the page dispatches on. */
  action?: string;
  /** If true and no argument is given, the dispatcher shows the usage hint. */
  requiresArg?: boolean;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  // ---- Planning ----
  {
    name: "plan",
    description: "Get a step-by-step plan only — no execution",
    usage: "/plan <task>",
    kind: "transform",
    requiresArg: true,
    transform: (arg) =>
      `Create a detailed, ordered plan to accomplish the task below. Output ONLY a numbered checklist of concrete steps, each with a one-line rationale. Do NOT execute the steps yet — just plan.\n\nTask: ${arg}`,
  },
  {
    name: "loop",
    aliases: ["refine"],
    description: "Iteratively draft → self-critique → improve, then answer",
    usage: "/loop <prompt>",
    kind: "transform",
    requiresArg: true,
    transform: (arg) =>
      `Work on this iteratively. Internally: (1) draft an answer, (2) critique it hard for errors, omissions, and weak spots, (3) produce an improved version. Repeat this draft→critique→improve cycle about 3 times, then present ONLY the final polished result.\n\n${arg}`,
  },
  {
    name: "think",
    description: "Reason step-by-step before answering",
    usage: "/think <prompt>",
    kind: "transform",
    requiresArg: true,
    transform: (arg) =>
      `Think through this carefully and step by step. Lay out your reasoning, verify it, then give a clear final answer.\n\n${arg}`,
  },

  // ---- Knowledge / web ----
  {
    name: "search",
    aliases: ["web"],
    description: "Web-search the query, then answer using the results",
    usage: "/search <query>",
    kind: "action",
    action: "search",
    requiresArg: true,
  },
  {
    name: "summarize",
    aliases: ["tldr"],
    description: "Summarize the conversation so far",
    usage: "/summarize",
    kind: "transform",
    transform: (arg) =>
      arg.trim()
        ? `Give a concise TL;DR (3-5 bullets) of the following:\n\n${arg}`
        : `Summarize our conversation so far: key points, decisions made, and any open questions. Keep it concise.`,
  },
  {
    name: "eli5",
    description: "Explain simply, as if to a smart 12-year-old",
    usage: "/eli5 <topic>",
    kind: "transform",
    requiresArg: true,
    transform: (arg) =>
      `Explain the following simply and intuitively, as if to a smart 12-year-old. Use plain language and a concrete analogy.\n\n${arg}`,
  },
  {
    name: "proofread",
    description: "Correct grammar/spelling and list the changes",
    usage: "/proofread <text>",
    kind: "transform",
    requiresArg: true,
    transform: (arg) =>
      `Proofread and correct the text below. Return the corrected version first, then a short bullet list of the changes you made.\n\n${arg}`,
  },

  // ---- Conversation actions ----
  {
    name: "remember",
    description: "Save a durable fact to long-term memory",
    usage: "/remember <fact>",
    kind: "action",
    action: "remember",
    requiresArg: true,
  },
  {
    name: "search-memory",
    aliases: ["mem-search", "find-memory"],
    description: "Search saved memories for matching facts",
    usage: "/search-memory <query>",
    kind: "action",
    action: "search-memory",
    requiresArg: true,
  },
  {
    name: "consolidate",
    description: "Review this chat and update long-term memory now",
    usage: "/consolidate",
    kind: "action",
    action: "consolidate",
  },
  {
    name: "compress",
    description: "Compress the conversation to save context",
    usage: "/compress",
    kind: "action",
    action: "compress",
  },
  {
    name: "title",
    description: "Auto-generate a title for this conversation",
    usage: "/title",
    kind: "action",
    action: "title",
  },

  // ---- Panels ----
  {
    name: "artifacts",
    description: "Open the artifacts panel",
    usage: "/artifacts",
    kind: "action",
    action: "artifacts",
  },
  {
    name: "scratchpad",
    aliases: ["notes"],
    description: "Open the scratchpad notes panel",
    usage: "/scratchpad",
    kind: "action",
    action: "scratchpad",
  },
  {
    name: "settings",
    description: "Open model settings",
    usage: "/settings",
    kind: "action",
    action: "settings",
  },
  {
    name: "help",
    aliases: ["commands"],
    description: "List all available slash commands",
    usage: "/help",
    kind: "action",
    action: "help",
  },
];

function findByNameOrAlias(name: string): SlashCommand | undefined {
  const lower = name.toLowerCase();
  return SLASH_COMMANDS.find(
    (c) => c.name === lower || c.aliases?.includes(lower),
  );
}

/**
 * Parse a raw input into a command + argument. Returns null when the input
 * is not a slash command or the command is unknown (so it sends as normal chat).
 */
export function parseCommand(
  input: string,
): { command: SlashCommand; arg: string } | null {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("/")) return null;
  const match = trimmed.match(/^\/(\w[\w-]*)\s*([\s\S]*)$/);
  if (!match) return null;
  const command = findByNameOrAlias(match[1]);
  if (!command) return null;
  return { command, arg: match[2] ?? "" };
}

/**
 * Commands matching the partial name the user is typing (the token after "/",
 * before any space). Used to drive the autocomplete popover. Empty query
 * returns all commands.
 */
export function matchCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase();
  if (!q) return SLASH_COMMANDS;
  const starts = SLASH_COMMANDS.filter(
    (c) => c.name.startsWith(q) || c.aliases?.some((a) => a.startsWith(q)),
  );
  const contains = SLASH_COMMANDS.filter(
    (c) =>
      !starts.includes(c) &&
      (c.name.includes(q) || c.description.toLowerCase().includes(q)),
  );
  return [...starts, ...contains];
}

/**
 * Given the current raw input, return the active autocomplete query if the
 * user is still typing the command token (input is "/", or "/word" with no
 * trailing space). Returns null once they've moved on to typing arguments.
 */
export function activeCommandQuery(input: string): string | null {
  if (!input.startsWith("/")) return null;
  const afterSlash = input.slice(1);
  if (/\s/.test(afterSlash)) return null; // past the command token
  return afterSlash;
}
