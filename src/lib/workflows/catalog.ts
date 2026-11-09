// Safe to import in the browser: no server code here. Each card's server code lives in ./cards.
import { z } from "zod";

export type CardType = "trigger" | "webSearch" | "agent" | "chatMessage";
export type CardCategory = "Start" | "Get data" | "AI" | "Output";

export interface FieldSpec {
  key: string;
  label: string;
  kind: "template" | "textarea" | "text" | "select" | "number" | "model" | "tools" | "outputFields" | "chat" | "perItem";
  help?: string;
  options?: { value: string; label: string }[];
  rows?: number;
  /** Fields that only apply when this returns true (for example Items, only when "Run once per item" is on). */
  when?: (config: Record<string, unknown>) => boolean;
}

export interface CardDef {
  type: CardType;
  label: string;
  category: CardCategory;
  /** lucide icon name; the UI maps it. */
  icon: string;
  description: string;
  schema: z.ZodType<Record<string, unknown>>;
  defaults: () => Record<string, unknown>;
  fields: FieldSpec[];
  /** Whether "Run once per item" exists on this card. */
  perItem: boolean;
  outputs: (config: Record<string, unknown>) => string[];
  summary: (config: Record<string, unknown>) => string;
}

export const OUTPUT_FIELD_TYPES = ["text", "number", "yesno", "list", "choice"] as const;
export const outputFieldSchema = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,31}$/, "Use letters, digits and _"),
  type: z.enum(OUTPUT_FIELD_TYPES),
  options: z.array(z.string()).optional(),
  description: z.string().default(""),
});
export type OutputField = z.infer<typeof outputFieldSchema>;

export const DEFAULT_MAX_ITEMS = 25;
export const MAX_ITEMS_LIMIT = 100;
export const MESSAGE_MAX_CHARS = 20_000;
/** Largest card output kept in a run (3.4). Also the cap on an agent's written report. */
export const OUTPUT_CAP_BYTES = 200_000;

const perItemShape = {
  perItem: z.boolean().default(false),
  items: z.string().default(""),
  maxItems: z.number().int().min(1).max(MAX_ITEMS_LIMIT).default(DEFAULT_MAX_ITEMS),
};
const perItemFields: FieldSpec[] = [
  { key: "perItem", label: "Run once per item", kind: "perItem", help: "Runs this card for each element of a list from an earlier card." },
  {
    key: "items",
    label: "Items",
    kind: "template",
    help: "One reference to a list, for example {{news.items}}. Use {{item}} and {{index}} below.",
    when: (c) => c.perItem === true,
  },
];

const trim = (s: unknown, n = 60) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

const trigger: CardDef = {
  type: "trigger",
  label: "Run manually",
  category: "Start",
  icon: "Play",
  description: "Starts the flow when you press Run.",
  schema: z.object({ kind: z.literal("manual").default("manual") }),
  defaults: () => ({ kind: "manual" }),
  fields: [],
  perItem: false,
  outputs: () => ["startedAt", "date"],
  summary: () => "Starts when you press Run",
};

const webSearch: CardDef = {
  type: "webSearch",
  label: "Web search",
  category: "Get data",
  icon: "Search",
  description: "Searches the web and returns titles, links and snippets.",
  schema: z.object({
    queries: z.string().default(""),
    provider: z.enum(["", "duckduckgo", "tavily"]).default(""),
    ...perItemShape,
  }),
  defaults: () => ({ queries: "", provider: "", perItem: false, items: "", maxItems: DEFAULT_MAX_ITEMS }),
  fields: [
    { key: "queries", label: "Queries", kind: "template", rows: 3, help: "One search per line. Templates are allowed." },
    {
      key: "provider",
      label: "Search provider",
      kind: "select",
      options: [
        { value: "", label: "Use my setting" },
        { value: "duckduckgo", label: "DuckDuckGo" },
        { value: "tavily", label: "Tavily" },
      ],
    },
    ...perItemFields,
  ],
  perItem: true,
  outputs: () => ["items", "count"],
  summary: (c) => {
    const n = String(c.queries ?? "").split("\n").filter((l) => l.trim()).length;
    return `${n} ${n === 1 ? "query" : "queries"}${c.queries ? ` · ${trim(String(c.queries).split("\n")[0], 40)}` : ""}`;
  },
};

/** Tools an agent card may offer (6.10), the only ones it can ever get. MCP tools arrive in phase 6. */
export const AGENT_TOOL_IDS = ["webSearch", "fetchUrl", "calculator", "jsonExtract", "currentTime", "searchChats", "readChat"] as const;
export const AGENT_TOOL_CHOICES: { id: (typeof AGENT_TOOL_IDS)[number]; label: string }[] = [
  { id: "webSearch", label: "Web search" },
  { id: "fetchUrl", label: "Fetch URL" },
  { id: "calculator", label: "Calculator" },
  { id: "jsonExtract", label: "JSON extract" },
  { id: "currentTime", label: "Current time" },
  { id: "searchChats", label: "Search chats" },
  { id: "readChat", label: "Read chat" },
];

const CHAT_READ_TOOLS: string[] = ["searchChats", "readChat"];
const OUTBOUND_TOOLS: string[] = ["fetchUrl", "webSearch"];
export const TOOL_CONFLICT_MESSAGE = "This card can read your chats and reach the web. Pick one, so a web page can't make it send your chats out.";

/** A card that reads chats must not also reach the web: a page it reads could steer it into sending chat text out. */
export const hasToolConflict = (tools: unknown): boolean =>
  Array.isArray(tools) && tools.some((t) => CHAT_READ_TOOLS.includes(t)) && tools.some((t) => OUTBOUND_TOOLS.includes(t));

const agent: CardDef = {
  type: "agent",
  label: "Agent",
  category: "AI",
  icon: "Bot",
  description: "A model reads the input, optionally uses tools, and writes a result.",
  schema: z.object({
    instructions: z.string().default(""),
    input: z.string().default(""),
    model: z.string().default(""),
    tools: z.array(z.enum(AGENT_TOOL_IDS)).default([]),
    outputFields: z.array(outputFieldSchema).default([]),
    preset: z.string().optional(),
    ...perItemShape,
  }),
  defaults: () => ({ instructions: "", input: "", model: "", tools: [], outputFields: [], perItem: false, items: "", maxItems: DEFAULT_MAX_ITEMS }),
  fields: [
    { key: "instructions", label: "Instructions", kind: "template", rows: 5 },
    { key: "input", label: "Input", kind: "template", rows: 2, help: "Data from earlier cards. The model treats it as data, never as instructions." },
    { key: "model", label: "Model", kind: "model", help: "Empty uses the workflow's default model." },
    { key: "tools", label: "Tools", kind: "tools" },
    { key: "outputFields", label: "Output fields", kind: "outputFields", help: "Empty means the output is plain text." },
    ...perItemFields,
  ],
  perItem: true,
  outputs: (c) => {
    if (c.perItem === true) return ["items", "count", "failed"];
    const fields = (c.outputFields as OutputField[] | undefined) ?? [];
    return fields.length ? fields.map((f) => f.name) : ["text"];
  },
  summary: (c) => trim(c.instructions) || "No instructions yet",
};

const chatMessage: CardDef = {
  type: "chatMessage",
  label: "Send to chat",
  category: "Output",
  icon: "MessageSquare",
  description: "Posts a message to a DevChat chat.",
  schema: z.object({
    chat: z.string().default("new"),
    title: z.string().default("{{workflow.name}} — {{run.date}}"),
    message: z.string().max(MESSAGE_MAX_CHARS).default(""),
  }),
  defaults: () => ({ chat: "new", title: "{{workflow.name}} — {{run.date}}", message: "" }),
  fields: [
    { key: "chat", label: "Chat", kind: "chat" },
    { key: "title", label: "Title for a new chat", kind: "template", rows: 1, when: (c) => c.chat === "new" || !c.chat },
    { key: "message", label: "Message", kind: "template", rows: 6, help: "Markdown. Up to 20,000 characters." },
  ],
  perItem: false,
  outputs: () => ["conversationId", "messageId"],
  summary: (c) => `${c.chat === "new" || !c.chat ? "A new chat each run" : "An existing chat"} · ${trim(c.message, 40)}`,
};

export const CATALOG: Record<CardType, CardDef> = { trigger, webSearch, agent, chatMessage };
export const CARD_TYPES = Object.keys(CATALOG) as CardType[];
/** Cards the user can add (the trigger is created with the workflow). */
export const ADDABLE_TYPES: CardType[] = ["webSearch", "agent", "chatMessage"];

export const isCardType = (t: unknown): t is CardType => typeof t === "string" && Object.hasOwn(CATALOG, t);

/** Config as the card's schema reads it, or the zod issues as `field: message` lines. */
export function parseConfig(type: CardType, config: unknown): { config: Record<string, unknown>; errors: { field: string; message: string }[] } {
  const r = CATALOG[type].schema.safeParse(config ?? {});
  if (r.success) return { config: r.data, errors: [] };
  return {
    config: { ...CATALOG[type].defaults(), ...((config as object) ?? {}) },
    errors: r.error.issues.map((i) => ({ field: String(i.path[0] ?? ""), message: i.message })),
  };
}

/** Template-typed values of a card's config, for reference checks: `{ field, value }`. */
export function templateValues(type: CardType, config: Record<string, unknown>): { field: string; value: string }[] {
  const out: { field: string; value: string }[] = [];
  for (const f of CATALOG[type].fields) {
    if (f.kind === "template" && typeof config[f.key] === "string") out.push({ field: f.key, value: config[f.key] as string });
  }
  return out;
}

/** The prompt for a field type, for the agent system prompt and the editor. */
export const OUTPUT_TYPE_HINT: Record<OutputField["type"], string> = {
  text: "text",
  number: "number",
  yesno: "yes or no",
  list: "list",
  choice: "choice",
};
