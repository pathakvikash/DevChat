// Safe to import in the browser: no server code here. Each card's server code lives in ./cards.
import { z } from "zod";
import { FILTER_OPS } from "./filterRules";

export type CardType = "trigger" | "webSearch" | "agent" | "chatMessage" | "fetch" | "filter" | "table";
export type CardCategory = "Start" | "Get data" | "AI" | "Logic" | "Table" | "Output";

export interface FieldSpec {
  key: string;
  label: string;
  kind: "template" | "textarea" | "text" | "select" | "number" | "model" | "tools" | "outputFields" | "chat" | "perItem" | "table" | "columnMap" | "rules" | "toggle";
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
  /** Fields whose templates may use {{item}} and {{index}} without "Run once per item" (the card reads its own list). */
  itemFields?: string[];
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

/** Whether the card reads chats (an agent with a chat-reading tool). */
export const readsChats = (type: string, config: Record<string, unknown>): boolean =>
  type === "agent" && Array.isArray(config.tools) && config.tools.some((t) => CHAT_READ_TOOLS.includes(t));

/** Whether the card reads data that must not leave DevChat. Today that is chats; MCP tools and a CLI folder join when phase 6 lands.
 *  A table written by a card that follows one of these becomes private (see markPrivateTables). */
export const readsPrivate = (type: string, config: Record<string, unknown>): boolean => readsChats(type, config);

/** Whether the card can send data to the web: an agent with an outbound tool, or a web search / fetch card. */
export const reachesWeb = (type: string, config: Record<string, unknown>): boolean =>
  type === "webSearch" || type === "fetch" || (type === "agent" && Array.isArray(config.tools) && config.tools.some((t) => OUTBOUND_TOOLS.includes(t)));

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

const FETCH_AS = { page: "Page text", feed: "RSS or Atom feed", json: "JSON" } as const;
const fetchCard: CardDef = {
  type: "fetch",
  label: "Fetch URL",
  category: "Get data",
  icon: "Globe",
  description: "Reads a web page, an RSS or Atom feed, or a JSON address.",
  schema: z.object({
    url: z.string().default(""),
    as: z.enum(["page", "feed", "json"]).default("page"),
    ...perItemShape,
  }),
  defaults: () => ({ url: "", as: "page", perItem: false, items: "", maxItems: DEFAULT_MAX_ITEMS }),
  fields: [
    { key: "url", label: "URL", kind: "template", rows: 1, help: "A template is allowed, for example {{item.url}}." },
    {
      key: "as",
      label: "Read it as",
      kind: "select",
      options: Object.entries(FETCH_AS).map(([value, label]) => ({ value, label })),
    },
    ...perItemFields,
  ],
  perItem: true,
  outputs: (c) => (c.perItem === true ? ["items", "count", "failed"] : c.as === "feed" ? ["title", "items", "count"] : c.as === "json" ? ["data"] : ["url", "text"]),
  summary: (c) => `${FETCH_AS[c.as as keyof typeof FETCH_AS] ?? FETCH_AS.page}${c.url ? ` · ${trim(c.url, 40)}` : ""}`,
};

const filterRuleSchema = z.object({ field: z.string().default(""), op: z.enum(FILTER_OPS).default("eq"), value: z.string().default("") });
const filterCard: CardDef = {
  type: "filter",
  label: "Filter",
  category: "Logic",
  icon: "Funnel",
  description: "Keeps the items that pass your rules. Can stop the flow when nothing is left.",
  schema: z.object({
    list: z.string().default(""),
    rules: z.array(filterRuleSchema).default([]),
    match: z.enum(["all", "any"]).default("all"),
    stopIfEmpty: z.boolean().default(true),
  }),
  defaults: () => ({ list: "", rules: [], match: "all", stopIfEmpty: true }),
  fields: [
    { key: "list", label: "List", kind: "template", rows: 1, help: "One reference to a list, for example {{save.inserted}}." },
    { key: "rules", label: "Rules", kind: "rules", help: "In a rule, {{item.field}} is the item being checked. No rules keeps everything." },
    {
      key: "match",
      label: "Keep an item when",
      kind: "select",
      options: [
        { value: "all", label: "All rules pass" },
        { value: "any", label: "Any rule passes" },
      ],
    },
    { key: "stopIfEmpty", label: "Stop if nothing is left", kind: "toggle", help: "The cards after this one are skipped when no items remain." },
  ],
  perItem: false,
  itemFields: ["rules"],
  outputs: () => ["items", "count", "removed"],
  summary: (c) => {
    const n = Array.isArray(c.rules) ? c.rules.length : 0;
    return `${n === 0 ? "No rules" : `${n} ${n === 1 ? "rule" : "rules"}`}${c.stopIfEmpty === false ? "" : " · stops if empty"}`;
  },
};

const tableCard: CardDef = {
  type: "table",
  label: "Save to table",
  category: "Table",
  icon: "Table2",
  description: "Adds items to a DevChat table, or updates rows already in it. Rows are matched by a key such as the URL.",
  schema: z.object({
    tableId: z.string().default(""),
    action: z.enum(["upsert", "update"]).default("upsert"),
    list: z.string().default(""),
    keyField: z.string().default("url"),
    fields: z.array(z.object({ column: z.string().default(""), value: z.string().default("") })).default([]),
    status: z.string().default(""),
  }),
  defaults: () => ({ tableId: "", action: "upsert", list: "", keyField: "url", fields: [], status: "" }),
  fields: [
    { key: "tableId", label: "Table", kind: "table" },
    {
      key: "action",
      label: "Action",
      kind: "select",
      options: [
        { value: "upsert", label: "Add new rows and update existing ones" },
        { value: "update", label: "Update existing rows only" },
      ],
    },
    { key: "list", label: "List", kind: "template", rows: 1, help: "One reference to a list, for example {{news.items}}." },
    { key: "keyField", label: "Match rows by", kind: "text", help: "The item field that identifies a row. A URL is matched ignoring case in the host, a trailing slash and utm_ parameters." },
    { key: "fields", label: "Columns", kind: "columnMap", help: "Empty saves every plain field of each item. In a value, {{item.field}} is the current item." },
    { key: "status", label: "Status", kind: "template", rows: 1, help: "New rows only when adding (empty means new). The matched rows when updating, and only if set." },
  ],
  perItem: false,
  itemFields: ["fields", "status"],
  outputs: () => ["inserted", "updated", "items", "missing"],
  summary: (c) => `${c.action === "update" ? "Update rows" : "Add and update rows"} by ${trim(c.keyField, 20) || "url"}`,
};

export const CATALOG: Record<CardType, CardDef> = { trigger, webSearch, agent, chatMessage, fetch: fetchCard, filter: filterCard, table: tableCard };
export const CARD_TYPES = Object.keys(CATALOG) as CardType[];
/** Cards the user can add (the trigger is created with the workflow). */
export const ADDABLE_TYPES: CardType[] = ["webSearch", "fetch", "agent", "filter", "table", "chatMessage"];

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
    const v = config[f.key];
    if (f.kind === "template" && typeof v === "string") out.push({ field: f.key, value: v });
    // A list of rules or column values: each template inside is checked under the list's own field name.
    if ((f.kind === "rules" || f.kind === "columnMap") && Array.isArray(v)) {
      for (const row of v as Record<string, unknown>[]) {
        for (const part of f.kind === "rules" ? [row?.field, row?.value] : [row?.value]) if (typeof part === "string") out.push({ field: f.key, value: part });
      }
    }
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
