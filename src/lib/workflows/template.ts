import { fenceText } from "@/lib/chat/quotePastChat";

/** What a `{{path}}` can reach. `nodes` holds each succeeded card's output by card id. */
export interface TemplateContext {
  nodes: Record<string, unknown>;
  vars: Record<string, string>;
  item?: unknown;
  index?: number;
  run: { id: string; date: string; startedAt: string };
  workflow: { name: string };
}

const REF = /\{\{\s*([^{}]*?)\s*\}\}/g;
const PATH = /^([a-z][a-z0-9_]*)((?:\.[A-Za-z_][\w-]*|\[\d+\])*)$/;
const SEGMENT = /\.([A-Za-z_][\w-]*)|\[(\d+)\]/g;

/** Every `{{path}}` in the text, in order, trimmed. */
export function templateRefs(template: string): string[] {
  return [...template.matchAll(REF)].map((m) => m[1]);
}

/** The root of a path: `score.fit` → `score`. */
export const refRoot = (path: string): string => path.match(/^[a-z][a-z0-9_]*/)?.[0] ?? "";

/** The text a value becomes inside mixed text: strings as they are, lists and objects as 2-space JSON, null as empty. */
export function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

function lookup(path: string, ctx: TemplateContext): unknown {
  const m = PATH.exec(path);
  if (!m) return undefined;
  const [, root, rest] = m;
  let cur: unknown =
    root === "vars" ? ctx.vars
    : root === "item" ? ctx.item
    : root === "index" ? ctx.index
    : root === "run" ? ctx.run
    : root === "workflow" ? ctx.workflow
    : ctx.nodes[root];
  for (const seg of rest.matchAll(SEGMENT)) {
    if (cur === null || cur === undefined) return undefined;
    const key = seg[1] ?? Number(seg[2]);
    if (typeof key === "number" ? !Array.isArray(cur) : typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[key as string];
  }
  return cur;
}

/** Card output and the current item come from outside the user's own text; with `fence` they go in fenced. */
const untrusted = (root: string) => root !== "vars" && root !== "run" && root !== "workflow" && root !== "index";

/**
 * Fills `{{path}}` references. A template that is one lone reference returns the raw value (a list stays a list);
 * mixed text returns a string. A missing path renders empty and is listed in `missing`.
 */
export function renderTemplate(
  template: string,
  ctx: TemplateContext,
  opts: { fence?: boolean } = {},
): { value: unknown; missing: string[] } {
  const missing: string[] = [];
  const note = (path: string) => {
    if (!missing.includes(path)) missing.push(path);
  };
  const lone = /^\s*\{\{\s*([^{}]*?)\s*\}\}\s*$/.exec(template);
  if (lone && !opts.fence) {
    const v = lookup(lone[1], ctx);
    if (v === undefined) {
      note(lone[1]);
      return { value: "", missing };
    }
    return { value: v, missing };
  }
  const value = template.replace(REF, (_all, path: string) => {
    const v = lookup(path, ctx);
    if (v === undefined) {
      note(path);
      return "";
    }
    const text = asText(v);
    return opts.fence && text && untrusted(refRoot(path)) ? fenceText(text) : text;
  });
  return { value, missing };
}

/** Renders to text whatever the value is (a lone list becomes JSON). */
export function renderText(template: string, ctx: TemplateContext, opts?: { fence?: boolean }) {
  const r = renderTemplate(template, ctx, opts);
  return { text: asText(r.value), missing: r.missing };
}
