import { generateText, type ModelMessage } from "ai";
import { z } from "zod";
import { contextWindowFor } from "@/lib/chat/contextBudget";
import type { ModelConfig } from "@/lib/models";
import { AGENT_TOOL_IDS, CATALOG, isCardType, parseConfig, type CardDef, type FieldSpec } from "./catalog";
import { MAX_NODES, parseGraph, TRIGGER_ID, validateStructure, checkGraph, type FlowNode, type WorkflowGraph } from "./graph";
import { buildTemplate, TEMPLATE_OPTIONS } from "./templates";
import { providerOptionsFor } from "@/lib/chat/providerOptions";

/** The graph format sent to the model: the same as 3.3, minus positions. */
const FORMAT = `{
  "vars": [{ "key": "topics", "label": "Topics, one per line", "value": "" }],
  "nodes": [
    { "id": "trigger", "type": "trigger", "fromIds": [], "config": {}, "label": "Run manually" },
    { "id": "news", "type": "webSearch", "fromIds": ["trigger"], "config": { "queries": "{{vars.topics}}" }, "label": "Search" }
  ]
}`;

const SMALL_WINDOW = 16_000;
export const MAX_GENERATED_CARDS = 12;

/** Settings only the user may set by hand (10): a generated flow never carries them. */
const SENSITIVE_KEYS = ["folder", "allowEdits"];
const SENSITIVE_TYPES = ["mcpTool"];
const isMcpName = (s: unknown) => typeof s === "string" && /^mcp[_:./-]|__/i.test(s);

export class GenerateError extends Error {}

const isSensitiveKey = (k: string) => SENSITIVE_KEYS.includes(k) || /^mcp/i.test(k);
/** Never sent to the model, and carried over from the current flow on a change. */
const isUserOnlyKey = (k: string) => k === "model" || isSensitiveKey(k);

function fieldLine(f: FieldSpec, def: Record<string, unknown>): string {
  const kind = f.options ? `one of ${f.options.map((o) => JSON.stringify(o.value)).join(", ")}` : f.kind === "tools" ? `list of ${AGENT_TOOL_IDS.join(", ")}` : f.kind;
  const dflt = JSON.stringify(def[f.key]);
  // The model picks nothing: an empty model uses the workflow's.
  return `    - ${f.key}: ${kind}, default ${dflt}${f.help ? `. ${f.help}` : ""}`;
}

function cardBlock(def: CardDef): string {
  const d = def.defaults();
  const outs = def.outputs(d).join(", ");
  return [`- ${def.type} ("${def.label}", ${def.category}): ${def.description}`, ...(def.fields.length ? ["  config:", ...def.fields.filter((f) => !isSensitiveKey(f.key)).map((f) => fieldLine(f, d))] : ["  config: none"]), `  outputs: ${outs}${def.type === "agent" ? " (with outputFields, one output per field)" : ""}`].join("\n");
}

/** Every card in the catalog registry, as text for the system prompt. Cards added later appear on their own. */
export function catalogForPrompt(): string {
  return Object.values(CATALOG)
    .filter((def) => !SENSITIVE_TYPES.includes(def.type))
    .map(cardBlock)
    .join("\n");
}

/** A graph as the model sees it: no positions, no variable values, no settings only the user may set. */
const forModel = (g: WorkflowGraph) => ({
  vars: g.vars.map((v) => ({ key: v.key, label: v.label, value: "" })),
  // A by-hand card (MCP tool) is a stub: the model sees where it sits, so it keeps the wiring, but not what it does.
  nodes: g.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    fromIds: n.fromIds,
    config: SENSITIVE_TYPES.includes(n.type) ? {} : Object.fromEntries(Object.entries(n.config).filter(([k]) => !isUserOnlyKey(k))),
    label: n.ui.label,
  })),
});

export function buildSystemPrompt(window: number): string {
  const parts = [
    "You design DevChat workflows. Reply with one ```json block holding the workflow and nothing else.",
    `Format (no positions):\n${FORMAT}`,
    `Cards you can use:\n${catalogForPrompt()}`,
    [
      "Templates: {{cardId.output}} reads an earlier card's output, {{vars.key}} reads a variable, {{run.date}} and {{workflow.name}} are always available.",
      'To run a card once per list item set "perItem": true and "items" to one reference such as "{{news.items}}", then use {{item}} and {{index}} in that card.',
      "A card may only reference cards that run before it (its fromIds, directly or further back).",
    ].join("\n"),
    [
      "Rules:",
      `- The one trigger card has id "trigger" and no fromIds.`,
      `- At most ${MAX_GENERATED_CARDS} cards. Ids are short snake_case.`,
      "- Keep anything worth keeping in a Table, when a Table card exists.",
      "- Use Filter to stop when nothing is new, when a Filter card exists.",
      "- Use Pick rows when the user must choose, when that card exists.",
      "- Never submit, apply or send outside DevChat.",
      "- Never add MCP tools, folders or edit permissions.",
      '- Things the user must paste become "vars" with an empty "value".',
      "- Leave agent \"model\" empty.",
    ].join("\n"),
  ];
  if (window >= SMALL_WINDOW) {
    const ex = TEMPLATE_OPTIONS.filter((t) => t.kind !== "blank").map((t) => JSON.stringify(forModel(buildTemplate(t.kind).graph)));
    parts.push(`Example workflows:\n${ex.join("\n")}`);
  }
  return parts.join("\n\n");
}

const MAX_REPLY_CHARS = 200_000;

/** The JSON object in a model reply. Fences are tried last to first, preferring one with a `nodes` array
 *  (a model may quote the old flow before the new one); then the outermost braces. */
export function extractJson(reply: string): unknown {
  const text = reply.slice(0, MAX_REPLY_CHARS);
  const parsed: Rec[] = [];
  const tryParse = (c: string) => {
    try {
      const v = JSON.parse(c);
      if (isRec(v)) parsed.push(v);
    } catch {
      // not JSON
    }
  };
  for (const m of [...text.matchAll(/```(?:json)?([\s\S]*?)```/gi)].reverse()) tryParse(m[1]);
  const flow = parsed.find((v) => Array.isArray(v.nodes));
  if (flow) return flow;
  tryParse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  return parsed.find((v) => Array.isArray(v.nodes)) ?? parsed[0];
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);

/** Removes what only the user may set by hand, and gives each card the shape the graph schema wants. Each removal is a warning. */
function sanitize(raw: Rec, current: WorkflowGraph | undefined, warnings: string[]): Rec {
  const all = (Array.isArray(raw.nodes) ? raw.nodes : []).filter(isRec);
  const was = (n: Rec) => current?.nodes.find((c) => c.id === n.id && c.type === n.type);
  const isDropped = (n: Rec) => SENSITIVE_TYPES.includes(String(n.type)) && !was(n);
  // A removed card's children connect to its parents, so the flow stays in one piece. An id that a kept card
  // also uses is never rewired: that id means the real card.
  const keptIds = new Set(all.filter((n) => !isDropped(n)).map((n) => String(n.id)));
  const dropped = new Map<string, string[]>();
  for (const n of all) {
    if (!isDropped(n)) continue;
    warnings.push(`Removed the "${n.id}" card: MCP tools can only be added by hand.`);
    if (!keptIds.has(String(n.id))) dropped.set(String(n.id), Array.isArray(n.fromIds) ? n.fromIds.map(String) : []);
  }
  // A by-hand card the reply lost shows in the preview, so Apply doesn't silently delete it.
  for (const c of current?.nodes ?? []) {
    if (SENSITIVE_TYPES.includes(c.type) && !all.some((n) => n.id === c.id && n.type === c.type)) warnings.push(`Removed the "${c.ui.label || c.id}" card: MCP tools can only be added by hand.`);
  }
  const through = (ids: string[]): string[] => {
    const out = new Set<string>();
    const seen = new Set<string>();
    const queue = [...ids];
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (dropped.has(id)) queue.push(...dropped.get(id)!);
      else out.add(id);
    }
    return [...out];
  };
  const out = all
    .filter((n) => !isDropped(n))
    .map((n) => {
      const config: Rec = isRec(n.config) ? { ...n.config } : {};
      const label = String(n.id);
      const before = was(n);
      const fromIds = through(Array.isArray(n.fromIds) ? n.fromIds.map(String) : []);
      const ui = isRec(n.ui) ? n.ui : {};
      const def = isCardType(n.type) ? CATALOG[n.type] : undefined;
      const card = { id: n.id, type: n.type, fromIds, ui: { label: String(ui.label ?? n.label ?? def?.label ?? n.id), position: { x: 0, y: 0 } } };
      // A by-hand card that is still the same card is the user's, whatever the reply says about it.
      if (before && SENSITIVE_TYPES.includes(String(n.type))) return { ...card, config: structuredClone(before.config) };

      for (const k of Object.keys(config)) {
        if (!isUserOnlyKey(k)) continue;
        delete config[k];
        if (k !== "model" && !(before && k in before.config)) warnings.push(`Removed "${k}" from "${label}": it can only be set by hand.`);
      }
      if (before) {
        const hand = Object.entries(before.config).filter(([k]) => isUserOnlyKey(k));
        for (const [k, v] of hand) if (k === "model") config[k] = v;
        // Folder, edit and MCP settings stay only while the card does the same job: same settings, same inputs.
        const same =
          JSON.stringify(editable(String(n.type), config)) === JSON.stringify(editable(String(n.type), before.config)) &&
          JSON.stringify([...fromIds].sort()) === JSON.stringify([...before.fromIds].sort());
        const risky = hand.filter(([k]) => k !== "model");
        if (same) for (const [k, v] of risky) config[k] = v;
        else if (risky.length) warnings.push(`"${label}" changed, so its folder, edit and MCP settings were removed. Set them again by hand.`);
      }
      if (Array.isArray(config.tools)) {
        const kept = config.tools.filter((t) => !isMcpName(t));
        if (kept.length !== config.tools.length) warnings.push(`Removed MCP tools from "${label}": they can only be ticked by hand.`);
        config.tools = kept;
      }
      return { ...card, config };
    });
  return { version: 1, vars: cleanVars(raw.vars, current), nodes: out };
}

/** What the model may edit on a card, in the schema's own shape, so two configs compare by JSON. */
function editable(type: string, config: Rec): unknown {
  const rest = Object.fromEntries(Object.entries(config).filter(([k]) => !isUserOnlyKey(k)));
  return isCardType(type) ? parseConfig(type, rest).config : rest;
}

const MAX_VARS = 20;
const MAX_VAR_VALUE = 2000;

/** `{ key, label, value }` for each usable variable: a valid, unique key; an empty value gets the current flow's. */
function cleanVars(raw: unknown, current: WorkflowGraph | undefined): { key: string; label: string; value: string }[] {
  const out = new Map<string, { key: string; label: string; value: string }>();
  for (const v of Array.isArray(raw) ? raw.filter(isRec) : []) {
    const key = typeof v.key === "string" ? v.key : "";
    if (!/^[\w-]+$/.test(key) || out.has(key)) continue;
    const value = (typeof v.value === "string" ? v.value : "") || current?.vars.find((c) => c.key === key)?.value || "";
    out.set(key, { key, label: typeof v.label === "string" && v.label ? v.label.slice(0, 200) : key, value: value.slice(0, MAX_VAR_VALUE) });
  }
  return [...out.values()].slice(0, MAX_VARS);
}

/** x = level × 280, y = place in the level × 160. A card's level is its longest path from the start. */
export function layoutGraph(graph: WorkflowGraph): WorkflowGraph {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const level = new Map<string, number>();
  const levelOf = (n: FlowNode): number => {
    const hit = level.get(n.id);
    if (hit !== undefined) return hit;
    level.set(n.id, 0); // a cycle can't reach here (validated), but never recurse forever
    const l = n.fromIds.reduce((m, f) => (byId.has(f) ? Math.max(m, levelOf(byId.get(f)!) + 1) : m), 0);
    level.set(n.id, l);
    return l;
  };
  const seen = new Map<number, number>();
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      const l = levelOf(n);
      const i = seen.get(l) ?? 0;
      seen.set(l, i + 1);
      return { ...n, ui: { ...n.ui, position: { x: l * 280, y: i * 160 } } };
    }),
  };
}

type Checked = { ok: true; graph: WorkflowGraph } | { ok: false; errors: string[] };

/** Shape, structure and each card's config. Reference problems are not errors here: they come back as warnings. */
function validate(raw: unknown, current: WorkflowGraph | undefined, warnings: string[], defaultModel: string): Checked {
  if (!isRec(raw)) return { ok: false, errors: ["The reply had no JSON object"] };
  // Before any work on the nodes: a huge reply is refused, not processed.
  if (Array.isArray(raw.nodes) && raw.nodes.length > MAX_NODES) return { ok: false, errors: [`Use at most ${MAX_GENERATED_CARDS} cards`] };
  if (Array.isArray(raw.vars) && raw.vars.length > MAX_VARS * 2) return { ok: false, errors: [`Use at most ${MAX_VARS} variables`] };
  const cleaned = sanitize(raw, current, warnings);
  let graph: WorkflowGraph;
  try {
    graph = parseGraph({ ...cleaned, defaultModel });
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : "Invalid workflow graph"] };
  }
  const errors = validateStructure(graph);
  if (graph.nodes.length > MAX_GENERATED_CARDS && graph.nodes.length <= MAX_NODES) errors.push(`Use at most ${MAX_GENERATED_CARDS} cards`);
  for (const n of graph.nodes) {
    if (!isCardType(n.type)) continue;
    for (const e of parseConfig(n.type, n.config).errors) errors.push(`${n.id}: ${e.field} ${e.message}`);
  }
  if (errors.length) return { ok: false, errors };
  // Defaults filled and unknown keys dropped, by each card's own schema.
  graph = { ...graph, nodes: graph.nodes.map((n) => ({ ...n, config: parseConfig(n.type, n.config).config })) };
  graph.nodes = graph.nodes.map((n) => (n.id === TRIGGER_ID ? { ...n, config: CATALOG.trigger.defaults() } : n));
  return { ok: true, graph };
}

export interface GenerateOptions {
  description: string;
  model: ModelConfig;
  /** The flow being changed, when it has cards beyond the trigger. */
  current?: WorkflowGraph;
  defaultModel?: string;
  signal?: AbortSignal;
  userId?: string;
}

/** A proposed flow for the description. Saves nothing. One repair call when the first reply is not a valid flow. */
export async function generateFlow(o: GenerateOptions): Promise<{ graph: WorkflowGraph; warnings: string[] }> {
  const system = buildSystemPrompt(contextWindowFor(o.model.id, o.model));
  // A flow that is only the trigger is a fresh start.
  const current = o.current && o.current.nodes.length > 1 ? o.current : undefined;
  const user = current ? `${o.description}\n\nChange this flow:\n\`\`\`json\n${JSON.stringify(forModel(current))}\n\`\`\`` : o.description;
  const messages: ModelMessage[] = [{ role: "user", content: user }];
  const defaultModel = o.defaultModel ?? o.current?.defaultModel ?? o.model.id;
  const providerOptions = providerOptionsFor({ modelId: o.model.id, numCtx: o.model.contextWindow, cwd: "", access: "chat", conversationId: "", userId: o.userId ?? "", allowedTools: [] });
  const ask = async () => {
    o.signal?.throwIfAborted();
    const { text } = await generateText({ model: o.model.model, system, messages, providerOptions, abortSignal: o.signal });
    o.signal?.throwIfAborted();
    return text;
  };

  const warnings: string[] = [];
  let reply = await ask();
  let checked = validate(extractJson(reply), current, warnings, defaultModel);
  if (!checked.ok) {
    warnings.length = 0;
    messages.push({ role: "assistant", content: reply.slice(0, MAX_REPLY_CHARS) }, { role: "user", content: `That flow has problems:\n${checked.errors.slice(0, 15).map((e) => `- ${e}`).join("\n")}\nReply with the corrected JSON only.` });
    reply = await ask();
    checked = validate(extractJson(reply), current, warnings, defaultModel);
  }
  if (!checked.ok) throw new GenerateError("Couldn't build a flow from that. Rephrase it or pick a stronger model.");

  const graph = layoutGraph(checked.graph);
  const fill = graph.vars.filter((v) => !v.value.trim()).map((v) => v.label || v.key);
  if (fill.length) warnings.push(`Fill in: ${fill.join(", ")}`);
  for (const i of checkGraph(graph)) warnings.push(i.message);
  return { graph, warnings: [...new Set(warnings)] };
}

export const generateBody = z.object({
  description: z.string().trim().min(1).max(4000),
  workflowId: z.string().optional(),
  model: z.string().optional(),
});
