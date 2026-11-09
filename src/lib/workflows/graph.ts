import { z } from "zod";
import { CATALOG, CODEX_BLOCKED, hasToolConflict, isCodexModelId, isCardType, leaksTo, parseConfig, PRIVATE_LEAK_MESSAGE, reachesOpenWeb, readsPrivate, templateValues, MCP_WEB_WARNING, TOOL_CONFLICT_MESSAGE, usesMcp, type CardType } from "./catalog";
import { refRoot, templateRefs } from "./template";

export const MAX_NODES = 30;
export const DEFAULT_MAX_RUN_TOKENS = 500_000;
export const ID_RE = /^[a-z][a-z0-9_]{0,31}$/;
export const RESERVED_IDS = ["vars", "item", "index", "run", "workflow"];
export const TRIGGER_ID = "trigger";

const nodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  fromIds: z.array(z.string()),
  config: z.record(z.string(), z.unknown()).default({}),
  ui: z.object({ label: z.string(), position: z.object({ x: z.number(), y: z.number() }) }),
});
const graphSchema = z.object({
  version: z.literal(1),
  defaultModel: z.string().default(""),
  maxRunTokens: z.number().int().min(1000).max(5_000_000).default(DEFAULT_MAX_RUN_TOKENS),
  vars: z.array(z.object({ key: z.string(), label: z.string(), value: z.string() })).default([]),
  nodes: z.array(nodeSchema),
});

export interface FlowNode {
  id: string;
  type: CardType;
  fromIds: string[];
  config: Record<string, unknown>;
  ui: { label: string; position: { x: number; y: number } };
}
export interface WorkflowGraph {
  version: 1;
  defaultModel: string;
  maxRunTokens: number;
  vars: { key: string; label: string; value: string }[];
  nodes: FlowNode[];
}

/** A graph from JSON text or an object. Throws "Invalid workflow graph: …" when the shape is wrong. */
export function parseGraph(raw: unknown): WorkflowGraph {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error("Invalid workflow graph: not JSON");
    }
  }
  const r = graphSchema.safeParse(value);
  if (!r.success) throw new Error(`Invalid workflow graph: ${r.error.issues[0]?.path.join(".") || "graph"} ${r.error.issues[0]?.message}`);
  return r.data as WorkflowGraph;
}

/** Structure errors that stop a save: ids, types, connectors, cycles. Config problems are not here (see checkGraph). */
export function validateStructure(graph: WorkflowGraph): string[] {
  const errors: string[] = [];
  if (graph.nodes.length > MAX_NODES) errors.push(`A workflow can have at most ${MAX_NODES} cards`);
  const ids = new Set<string>();
  for (const n of graph.nodes) {
    if (!ID_RE.test(n.id)) errors.push(`Card id "${n.id}" must be lowercase letters, digits and _, starting with a letter`);
    else if (RESERVED_IDS.includes(n.id)) errors.push(`Card id "${n.id}" is reserved`);
    if (ids.has(n.id)) errors.push(`Card id "${n.id}" is used twice`);
    ids.add(n.id);
    if (!isCardType(n.type)) errors.push(`Card "${n.id}" has an unknown type "${n.type}"`);
  }
  const triggers = graph.nodes.filter((n) => n.type === "trigger");
  if (triggers.length !== 1) errors.push("A workflow needs exactly one trigger card");
  else if (triggers[0].id !== TRIGGER_ID) errors.push(`The trigger card's id must be "${TRIGGER_ID}"`);
  else if (triggers[0].fromIds.length > 0) errors.push("The trigger card has no inputs");
  for (const n of graph.nodes) {
    for (const from of n.fromIds) {
      if (!ids.has(from)) errors.push(`Card "${n.id}" is connected to "${from}", which does not exist`);
      if (from === n.id) errors.push(`Card "${n.id}" is connected to itself`);
    }
  }
  for (const n of graph.nodes) {
    const sameCard = cardConflict(n, graph.defaultModel);
    if (sameCard) errors.push(sameCard);
  }
  if (errors.length === 0) for (const l of chatLeaks(graph)) errors.push(l.message);
  if (errors.length === 0 && topoOrder(graph).length !== graph.nodes.length) errors.push("The cards form a loop");
  return errors;
}

const byPosition = (a: FlowNode, b: FlowNode) =>
  a.ui.position.x - b.ui.position.x || a.ui.position.y - b.ui.position.y || a.id.localeCompare(b.id);

/** Run order: Kahn's algorithm, ties broken by position (x, then y). Cards in a cycle are left out. */
export function topoOrder(graph: WorkflowGraph): FlowNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const left = new Map(graph.nodes.map((n) => [n.id, new Set(n.fromIds.filter((f) => byId.has(f)))]));
  const out: FlowNode[] = [];
  while (left.size > 0) {
    const ready = [...left].filter(([, deps]) => deps.size === 0).map(([id]) => byId.get(id)!).sort(byPosition);
    if (ready.length === 0) break;
    const next = ready[0];
    out.push(next);
    left.delete(next.id);
    for (const deps of left.values()) deps.delete(next.id);
  }
  return out;
}

/** Every card that runs before `id` and feeds it, directly or not. */
export function ancestorsOf(graph: WorkflowGraph, id: string): Set<string> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const walk = (cur: string) => {
    for (const f of byId.get(cur)?.fromIds ?? []) {
      if (!seen.has(f)) {
        seen.add(f);
        walk(f);
      }
    }
  };
  walk(id);
  return seen;
}

/** One card that both reads private data and reaches the web (chat or folder or MCP with a web tool, folder with MCP), or null. */
function cardConflict(n: FlowNode, defaultModel: string): string | null {
  const label = n.ui.label || n.id;
  if (n.type === "agent" && isCodexModelId(String(n.config.model || defaultModel))) return `${label}: ${CODEX_BLOCKED}`;
  if (n.type === "agent" && hasToolConflict(n.config.tools, n.config.mcpTools)) return `${label}: ${TOOL_CONFLICT_MESSAGE}`;
  if (leaksTo(n, n, defaultModel)) return `${label} reads private data (chats, MCP or a folder) and reaches the web itself. Untick one, so a web page can't make it send your data out.`;
  return null;
}

/** A card that reads private data (chats, MCP, a folder) with a card that reaches the web somewhere after it: the data could travel along the flow and out. */
export function chatLeaks(graph: WorkflowGraph): { nodeId: string; message: string }[] {
  const out: { nodeId: string; message: string }[] = [];
  for (const n of graph.nodes) {
    if (!readsPrivate(n.type, n.config, graph.defaultModel)) continue;
    const downstream = graph.nodes.some((m) => m.id !== n.id && ancestorsOf(graph, m.id).has(n.id) && leaksTo(n, m, graph.defaultModel));
    if (downstream) out.push({ nodeId: n.id, message: PRIVATE_LEAK_MESSAGE(n.ui.label || n.id) });
  }
  return out;
}

export interface GraphIssue {
  nodeId: string;
  message: string;
  field?: string;
  /** Shown in the editor but does not stop a run. */
  warning?: boolean;
}

const SINGLE_REF = /^\s*\{\{\s*[^{}]+?\s*\}\}\s*$/;

/** Config and reference problems (5.3). The editor shows them as warnings; Run refuses on them. */
export function checkGraph(graph: WorkflowGraph): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const ids = new Set(graph.nodes.map((n) => n.id));
  const varKeys = new Set(graph.vars.map((v) => v.key));
  for (const n of graph.nodes) {
    if (!isCardType(n.type)) continue;
    const label = n.ui.label || n.id;
    const { config, errors } = parseConfig(n.type, n.config);
    for (const e of errors) issues.push({ nodeId: n.id, field: e.field, message: `${label}: ${e.field} ${e.message}` });
    const isPerItem = CATALOG[n.type].perItem && config.perItem === true;
    if (isPerItem && !SINGLE_REF.test(String(config.items ?? ""))) {
      issues.push({ nodeId: n.id, field: "items", message: `${label}: Items must be one reference to a list, like {{news.items}}` });
    }
    const sameCard = cardConflict({ ...n, config }, graph.defaultModel);
    if (sameCard) issues.push({ nodeId: n.id, field: sameCard.includes(CODEX_BLOCKED) ? "model" : "tools", message: sameCard });
    if (n.type === "webSearch" && !String(config.queries ?? "").trim()) issues.push({ nodeId: n.id, field: "queries", message: `${label}: add at least one query` });
    if (n.type === "agent" && !String(config.instructions ?? "").trim()) issues.push({ nodeId: n.id, field: "instructions", message: `${label}: add instructions` });
    if (n.type === "chatMessage" && !String(config.message ?? "").trim()) issues.push({ nodeId: n.id, field: "message", message: `${label}: add a message` });
    if (n.type === "fetch" && !String(config.url ?? "").trim()) issues.push({ nodeId: n.id, field: "url", message: `${label}: add a URL` });
    if ((n.type === "filter" || n.type === "table") && !String(config.list ?? "").trim()) issues.push({ nodeId: n.id, field: "list", message: `${label}: add the list to work on, like {{news.items}}` });
    if ((n.type === "table" || n.type === "sheetSync") && !String(config.tableId ?? "").trim()) issues.push({ nodeId: n.id, field: "tableId", message: `${label}: pick a table` });
    if (n.type === "mcpTool" && !String(config.tool ?? "").trim()) issues.push({ nodeId: n.id, field: "tool", message: `${label}: pick a tool` });
    if (n.type === "agent" && config.allowEdits === true && !config.folder) issues.push({ nodeId: n.id, field: "allowEdits", message: `${label}: Allow edits needs a working folder` });
    const ancestors = ancestorsOf(graph, n.id);
    if (usesMcp(n.type, config)) {
      const web = reachesOpenWeb(n.type, config, graph.defaultModel) || [...ancestors].some((a) => {
        const up = graph.nodes.find((x) => x.id === a);
        return !!up && reachesOpenWeb(up.type, up.config, graph.defaultModel);
      });
      if (web) issues.push({ nodeId: n.id, field: n.type === "agent" ? "mcpTools" : "tool", warning: true, message: `${label}: ${MCP_WEB_WARNING}` });
      if ([...ancestors].some((a) => { const up = graph.nodes.find((x) => x.id === a); return !!up && usesMcp(up.type, up.config); })) {
        issues.push({ nodeId: n.id, field: n.type === "agent" ? "mcpTools" : "tool", warning: true, message: `${label}: an earlier card read data through MCP. Check what you pass on.` });
      }
    }
    for (const { field, value } of templateValues(n.type, config)) {
      for (const path of templateRefs(value)) {
        const root = refRoot(path);
        if (root === "item" || root === "index") {
          if (!(isPerItem || CATALOG[n.type].itemFields?.includes(field)) || field === "items") issues.push({ nodeId: n.id, field, message: `${label}: {{${path}}} needs "Run once per item" turned on` });
        } else if (root === "vars") {
          const key = path.match(/^vars\.([\w-]+)/)?.[1];
          if (key && !varKeys.has(key)) issues.push({ nodeId: n.id, field, message: `${label}: variable "${key}" is not defined` });
        } else if (root === "run" || root === "workflow") {
          // always available
        } else if (!ids.has(root)) {
          issues.push({ nodeId: n.id, field, message: `${label}: {{${path}}} refers to a card that does not exist` });
        } else if (!ancestors.has(root)) {
          issues.push({ nodeId: n.id, field, message: `${label}: {{${path}}} refers to a card that does not run before this one` });
        }
      }
    }
  }
  for (const l of chatLeaks(graph)) issues.push({ nodeId: l.nodeId, field: "tools", message: l.message });
  return issues;
}

/** A card id from its label ("Score fit" → score_fit), made unique among `taken`. */
export function idFromLabel(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 28);
  if (!/^[a-z]/.test(base)) base = `card_${base}`.replace(/_$/, "");
  if (RESERVED_IDS.includes(base) || base === TRIGGER_ID) base = `${base}_card`;
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
  return id;
}

export function emptyGraph(defaultModel = ""): WorkflowGraph {
  return {
    version: 1,
    defaultModel,
    maxRunTokens: DEFAULT_MAX_RUN_TOKENS,
    vars: [],
    nodes: [{ id: TRIGGER_ID, type: "trigger", fromIds: [], config: CATALOG.trigger.defaults(), ui: { label: "Run manually", position: { x: 0, y: 0 } } }],
  };
}

/** A new card on the end of the flow, connected to the last card. */
export function newCard(graph: WorkflowGraph, type: CardType): FlowNode {
  const def = CATALOG[type];
  const last = topoOrder(graph).at(-1);
  return {
    id: idFromLabel(def.label, graph.nodes.map((n) => n.id)),
    type,
    fromIds: last ? [last.id] : [],
    config: def.defaults(),
    ui: { label: def.label, position: { x: (last?.ui.position.x ?? -LAYOUT_DX) + LAYOUT_DX, y: last?.ui.position.y ?? 0 } },
  };
}

// ─── Run records (3.4). Browser-safe: the editor reads them from the polling endpoint. ───

export type RunState = "running" | "waiting" | "succeeded" | "failed" | "cancelled" | "interrupted";
export type CardStatus = "running" | "succeeded" | "failed" | "skipped" | "waiting";

export interface CardStep {
  tool: string;
  label: string;
  state: "running" | "done" | "error";
}

export interface CardRun {
  status: CardStatus;
  startedAt?: string;
  endedAt?: string;
  /** Capped at 200 KB; the polling endpoint leaves it out and `?node=` returns it. */
  output?: unknown;
  error?: string;
  skippedReason?: string;
  warnings?: string[];
  /** The card is Done but hands nothing on: the cards after it are Skipped with this reason (Filter with nothing left). */
  stopReason?: string;
  items?: { done: number; failed: number; total: number };
  itemErrors?: { index: number; error: string }[];
  usage?: { inputTokens: number; outputTokens: number };
  log?: CardStep[];
  /** A per-item card's finished items, kept so a resume runs only the rest. Gone once the card ends. */
  partial?: { total: number; results: Record<string, Record<string, unknown>>; usage: { inputTokens: number; outputTokens: number } };
}

export const TERMINAL_STATES: RunState[] = ["succeeded", "failed", "cancelled", "interrupted"];
export const ACTIVE_STATES: RunState[] = ["running", "waiting"];

// ─── Canvas (phase 4) ───

/** Spacing of `autoLayout`: a column per level, a row per card. Multiples of the canvas's 20px snap grid. */
export const LAYOUT_DX = 340;
export const LAYOUT_DY = 140;
export const LOOP_MESSAGE = "Cards can't loop back";

/**
 * Positions by level: a card sits one column right of its furthest input. Cards in one level stack in run order,
 * centred on y 0. Cards caught in a loop go in a last column. Pure: returns a new graph.
 */
export function autoLayout(graph: WorkflowGraph): WorkflowGraph {
  const order = topoOrder(graph);
  const level = new Map<string, number>();
  for (const n of order) level.set(n.id, Math.max(-1, ...n.fromIds.map((f) => level.get(f) ?? -1)) + 1);
  const last = Math.max(-1, ...level.values()) + 1;
  for (const n of graph.nodes) if (!level.has(n.id)) level.set(n.id, last);
  const columns = new Map<number, string[]>();
  for (const n of [...order, ...graph.nodes.filter((m) => !order.includes(m))]) {
    const l = level.get(n.id)!;
    columns.set(l, [...(columns.get(l) ?? []), n.id]);
  }
  const snap = (v: number) => Math.sign(v) * Math.round(Math.abs(v) / 20) * 20; // symmetric, so -70 and 70 mirror
  const pos = new Map<string, { x: number; y: number }>();
  for (const [l, ids] of columns) ids.forEach((id, row) => pos.set(id, { x: l * LAYOUT_DX, y: snap((row - (ids.length - 1) / 2) * LAYOUT_DY) }));
  return { ...graph, nodes: graph.nodes.map((n) => ({ ...n, ui: { ...n.ui, position: pos.get(n.id)! } })) };
}

/** Why `from → to` can't be drawn, or null. Uses the save rules (validateStructure), so the canvas and the server agree. */
export function connectionError(graph: WorkflowGraph, from: string, to: string): string | null {
  const target = graph.nodes.find((n) => n.id === to);
  if (!target || !graph.nodes.some((n) => n.id === from)) return "That card no longer exists";
  if (from === to || ancestorsOf(graph, from).has(to)) return LOOP_MESSAGE;
  if (target.fromIds.includes(from)) return "Those cards are already connected";
  const before = new Set(validateStructure(graph));
  const candidate = { ...graph, nodes: graph.nodes.map((n) => (n.id === to ? { ...n, fromIds: [...n.fromIds, from] } : n)) };
  return validateStructure(candidate).find((e) => !before.has(e)) ?? null;
}

/**
 * `node` with its `fromIds` checked one by one against the save rules, as if it were added unconnected first.
 * A connection that breaks a rule is left out and its message returned, so the card still lands, unconnected.
 */
export function connectNew(graph: WorkflowGraph, node: FlowNode): { node: FlowNode; error: string | null } {
  let current: FlowNode = { ...node, fromIds: [] };
  let error: string | null = null;
  for (const from of node.fromIds) {
    const err = connectionError({ ...graph, nodes: [...graph.nodes, current] }, from, node.id);
    if (err) error ??= err;
    else current = { ...current, fromIds: [...current.fromIds, from] };
  }
  return { node: current, error };
}
