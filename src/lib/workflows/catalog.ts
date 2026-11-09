// Safe to import in the browser: no server code here. Each card's server code lives in ./cards.
import { z } from "zod";
import { FILTER_OPS } from "./filterRules";

export type CardType = "trigger" | "webSearch" | "agent" | "chatMessage" | "mcpTool" | "fetch" | "filter" | "table" | "jobBoards" | "pickRows";
export type CardCategory = "Start" | "Get data" | "AI" | "Logic" | "Table" | "Output";

export interface FieldSpec {
  key: string;
  label: string;
  kind: "template" | "textarea" | "text" | "select" | "number" | "model" | "tools" | "outputFields" | "chat" | "perItem" | "mcpTools" | "mcpServer" | "mcpToolName" | "args" | "folder" | "allowEdits" | "table" | "columnMap" | "rules" | "toggle";
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

export const isCodexModelId = (id: string): boolean => id.startsWith("codex/");
/** Its offline flags are unverified until a live check runs, so a workflow card can't use it yet (lift this in `cardConflict`). */
export const CODEX_BLOCKED = "Codex can't run workflow cards yet. Pick another model.";
/** CLI model ids start with their provider id (cliProviders.ts); kept here because that file is server-only. */
export const isCliModelId = (id: string): boolean => /^(claude-code|codex|opencode)\//.test(id);
/** What an MCP tool card and an agent card with MCP tools can do outside DevChat (8.5). */
export const MCP_WARNING = "Can change things outside DevChat";
export const MCP_WEB_WARNING = "This card reads web pages and can act through MCP. A page could try to steer it.";
export const mcpToolIds = (config: Record<string, unknown>): string[] => (Array.isArray(config.mcpTools) ? (config.mcpTools as string[]) : []);

const CHAT_READ_TOOLS: string[] = ["searchChats", "readChat"];
const OUTBOUND_TOOLS: string[] = ["fetchUrl", "webSearch"];
export const TOOL_CONFLICT_MESSAGE = "This card can read your chats and reach the web. Pick one, so a web page can't make it send your chats out.";

type Cfg = Record<string, unknown>;
const toolList = (c: Cfg): string[] => (Array.isArray(c.tools) ? (c.tools as string[]) : []);

/** A command-line model with a folder: it can read the folder. Workflow cards run it with its own web tools switched off (`web: false`). */
export const hasCliFolder = (type: string, config: Cfg, defaultModel = ""): boolean =>
  type === "agent" && !!config.folder && isCliModelId(String(config.model || defaultModel));

/** Whether the card reads chats (an agent with a chat-reading tool). */
export const readsChats = (type: string, config: Cfg): boolean => type === "agent" && toolList(config).some((t) => CHAT_READ_TOOLS.includes(t));

/** Whether the card uses MCP: the MCP tool card, or an agent with any MCP tool. */
export const usesMcp = (type: string, config: Cfg): boolean => type === "mcpTool" || (type === "agent" && mcpToolIds(config).length > 0);

/** Private data a card can read: chats, MCP servers, or a folder. */
export const readsPrivate = (type: string, config: Cfg, defaultModel = ""): boolean =>
  readsChats(type, config) || usesMcp(type, config) || hasCliFolder(type, config, defaultModel);

/** The open web: a search, fetch or job boards card, or an agent with a web tool. */
export const reachesOpenWeb = (type: string, config: Cfg, _defaultModel = ""): boolean =>
  type === "webSearch" || type === "fetch" || type === "jobBoards" || (type === "agent" && toolList(config).some((t) => OUTBOUND_TOOLS.includes(t)));

/** Can send data out: the open web, or MCP (servers can make network calls). */
export const reachesWeb = (type: string, config: Cfg, defaultModel = ""): boolean => reachesOpenWeb(type, config, defaultModel) || usesMcp(type, config);

/** Whether `later` may come after `earlier` (reader). A private reader must not feed a card that reaches the web,
 *  except MCP followed by MCP: both are servers the user set up themselves. */
export const leaksTo = (earlier: { type: string; config: Cfg }, later: { type: string; config: Cfg }, defaultModel = ""): boolean => {
  if (!readsPrivate(earlier.type, earlier.config, defaultModel) || !reachesWeb(later.type, later.config, defaultModel)) return false;
  const mcpToMcp =
    !readsChats(earlier.type, earlier.config) && !hasCliFolder(earlier.type, earlier.config, defaultModel) && !reachesOpenWeb(later.type, later.config, defaultModel);
  return !mcpToMcp;
};

export const PRIVATE_LEAK_MESSAGE = (label: string) =>
  `${label} reads private data (chats, MCP or a folder) and a later card reaches the web. Split them into two workflows, so a web page can't make it send your data out.`;

/** A card that reads chats must not also reach the web or use MCP: a page it reads could steer it into sending chat text out. */
export const hasToolConflict = (tools: unknown, mcpTools: unknown = []): boolean =>
  Array.isArray(tools) &&
  tools.some((t) => CHAT_READ_TOOLS.includes(t)) &&
  (tools.some((t) => OUTBOUND_TOOLS.includes(t)) || (Array.isArray(mcpTools) && mcpTools.length > 0));

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
    /** Owner only. Ids like mcp_<server>_<tool>, checked at run time against the user's enabled servers. The enum above stays closed. */
    mcpTools: z.array(z.string().regex(/^mcp_.{1,200}$/)).max(20).default([]),
    /** Owner only, CLI models only: a folder Claude Code has worked in, and whether the model may change files in it. */
    folder: z.string().max(1000).default(""),
    allowEdits: z.boolean().default(false),
    outputFields: z.array(outputFieldSchema).default([]),
    preset: z.string().optional(),
    ...perItemShape,
  }),
  defaults: () => ({ instructions: "", input: "", model: "", tools: [], mcpTools: [], folder: "", allowEdits: false, outputFields: [], perItem: false, items: "", maxItems: DEFAULT_MAX_ITEMS }),
  fields: [
    { key: "instructions", label: "Instructions", kind: "template", rows: 5 },
    { key: "input", label: "Input", kind: "template", rows: 2, help: "Data from earlier cards. The model treats it as data, never as instructions." },
    { key: "model", label: "Model", kind: "model", help: "Empty uses the workflow's default model." },
    { key: "tools", label: "Tools", kind: "tools" },
    { key: "mcpTools", label: "MCP tools", kind: "mcpTools", help: "Only for the server's owner. Each tool you tick can be called without asking." },
    { key: "folder", label: "Working folder", kind: "folder", help: "Command-line models only. Without one the model can't see any files." },
    { key: "allowEdits", label: "Allow edits in the folder", kind: "allowEdits" },
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

const mcpTool: CardDef = {
  type: "mcpTool",
  label: "MCP tool",
  category: "Output",
  icon: "Plug",
  description: `${MCP_WARNING}. Calls one tool on one of your MCP servers. Only for the server's owner.`,
  schema: z.object({
    serverId: z.string().default(""),
    tool: z.string().max(200).default(""),
    args: z.record(z.string(), z.string()).default({}),
    ...perItemShape,
  }),
  defaults: () => ({ serverId: "", tool: "", args: {}, perItem: false, items: "", maxItems: DEFAULT_MAX_ITEMS }),
  fields: [
    { key: "serverId", label: "MCP server", kind: "mcpServer" },
    { key: "tool", label: "Tool", kind: "mcpToolName", help: "Pick a tool from that server." },
    { key: "args", label: "Arguments", kind: "args", help: "Values can use templates such as {{item.url}}." },
    ...perItemFields,
  ],
  perItem: true,
  outputs: (c) => (c.perItem === true ? ["items", "count", "failed"] : ["text", "data"]),
  summary: (c) => (c.tool ? `Calls ${trim(c.tool, 40)}` : "No tool picked yet"),
};


// ─── Phase 3: Job boards and Pick rows (new cards go at the end of the lists) ───

export const DEFAULT_MAX_JOBS = 60;
export const DEFAULT_MAX_PICK = 10;
export const MAX_PICK_LIMIT = 25; // the same as the default of a per-item card after it, and keeps Continue's output well under 200 KB
/** The status a picked row gets, and the one pickRows offers, unless the card says otherwise. */
export const DEFAULT_PICK_STATUS = "picked";

const jobBoards: CardDef = {
  type: "jobBoards",
  label: "Job boards",
  category: "Get data",
  icon: "Briefcase",
  description: "Reads the public job boards of companies on Greenhouse, Ashby and Lever, and keeps the jobs that match.",
  schema: z.object({
    boards: z.string().default(""),
    titleInclude: z.string().default(""),
    titleExclude: z.string().default(""),
    locationAllow: z.string().default(""),
    locationBlock: z.string().default(""),
    maxItems: z.number().int().min(1).max(1000).default(DEFAULT_MAX_JOBS),
  }),
  defaults: () => ({ boards: "", titleInclude: "", titleExclude: "", locationAllow: "", locationBlock: "", maxItems: DEFAULT_MAX_JOBS }),
  fields: [
    { key: "boards", label: "Careers pages", kind: "textarea", rows: 3, help: "One address per line: jobs.ashbyhq.com/<company>, jobs.lever.co/<company> or job-boards.greenhouse.io/<company>." },
    { key: "titleInclude", label: "Title has any of", kind: "textarea", rows: 2, help: "One word per line. Empty keeps every title." },
    { key: "titleExclude", label: "Title has none of", kind: "textarea", rows: 2, help: "One word per line." },
    { key: "locationAllow", label: "Location has any of", kind: "textarea", rows: 2, help: "One word per line. Empty keeps every location. A job with no location is kept." },
    { key: "locationBlock", label: "Location has none of", kind: "textarea", rows: 2, help: "One word per line. Wins over the list above." },
    { key: "maxItems", label: "Most jobs to keep", kind: "number" },
  ],
  perItem: false,
  outputs: () => ["items", "count", "errors"],
  summary: (c) => {
    const n = String(c.boards ?? "").split("\n").filter((l) => l.trim()).length;
    return `${n} ${n === 1 ? "board" : "boards"}${c.titleInclude ? ` · title has ${trim(String(c.titleInclude).split("\n")[0], 30)}` : ""}`;
  },
};

const pickRows: CardDef = {
  type: "pickRows",
  label: "Pick rows",
  category: "Table",
  icon: "ListChecks",
  description: "Pauses the run so you can tick rows in a table. The cards after it work on the rows you pick.",
  schema: z.object({
    tableId: z.string().default(""),
    /** The statuses on offer, separated by commas. */
    statuses: z.string().default("new"),
    sortBy: z.string().default(""),
    maxPick: z.number().int().min(1).max(MAX_PICK_LIMIT).default(DEFAULT_MAX_PICK),
    message: z.string().max(200).default(""),
    setStatus: z.string().max(60).default(DEFAULT_PICK_STATUS),
  }),
  defaults: () => ({ tableId: "", statuses: "new", sortBy: "", maxPick: DEFAULT_MAX_PICK, message: "", setStatus: DEFAULT_PICK_STATUS }),
  fields: [
    { key: "tableId", label: "Table", kind: "table" },
    { key: "statuses", label: "Offer rows with status", kind: "text", help: "Separate several with commas. Only rows with one of these statuses can be picked." },
    { key: "sortBy", label: "Sort by", kind: "text", help: "A column to sort by, highest first. Empty keeps the newest rows first." },
    { key: "maxPick", label: "Most rows to pick", kind: "number" },
    { key: "message", label: "What the rows are for", kind: "text", help: "Shown in the banner, for example “Draft application”." },
    { key: "setStatus", label: "Status of picked rows", kind: "text", help: "Rows you pick get this status. Empty leaves it as it is." },
  ],
  perItem: false,
  outputs: () => ["items", "count"],
  summary: (c) => `Pick up to ${Number(c.maxPick) || DEFAULT_MAX_PICK} rows${c.message ? ` · ${trim(c.message, 30)}` : ""}`,
};

/** The statuses a Pick rows card offers, from its comma-separated field. */
export const pickStatuses = (c: Record<string, unknown>): string[] => [...new Set(String(c.statuses ?? "").split(",").map((s) => s.trim()).filter(Boolean))];

export const CATALOG: Record<CardType, CardDef> = { trigger, webSearch, agent, chatMessage, mcpTool, fetch: fetchCard, filter: filterCard, table: tableCard, jobBoards, pickRows };
export const CARD_TYPES = Object.keys(CATALOG) as CardType[];
/** Cards the user can add (the trigger is created with the workflow). */
export const ADDABLE_TYPES: CardType[] = ["webSearch", "fetch", "agent", "filter", "table", "mcpTool", "chatMessage", "jobBoards", "pickRows"];

/** The template whose list gives a card its {{item}}: the Items field of a per-item card, or the List field of a card (Filter,
 *  Save to table) that reads {{item}} in its rules and columns. Undefined when the card has no item. */
export function itemListOf(type: CardType, config: Record<string, unknown>): string | undefined {
  const def = CATALOG[type];
  if (def.perItem && config.perItem === true) return String(config.items ?? "");
  if (def.itemFields?.length) return String(config.list ?? "");
  return undefined;
}

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
    if (f.kind === "args" && v && typeof v === "object") {
      for (const a of Object.values(v as Record<string, unknown>)) if (typeof a === "string") out.push({ field: f.key, value: a });
    }
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
