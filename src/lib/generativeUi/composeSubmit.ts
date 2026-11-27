const MAX_VALUE = 2000;
const MAX_TOTAL = 8000;
const FIELD_TYPES = new Set(["Input", "Checkbox", "Select"]);
const BOUND_PROPS = ["value", "checked"];

type El = { type?: string; props?: Record<string, any>; on?: Record<string, any>; watch?: unknown; [k: string]: any };
type Spec = { elements?: Record<string, El>; [k: string]: any };

/**
 * A spec is model-authored (or came from a tool result), so it is not trusted to trigger anything:
 * `watch` bindings run on state change with no click, so they are removed everywhere, and the only
 * event kept is a Button's `on.press -> submit`, stripped of params (the handler ignores them anyway).
 */
export function sanitizeSpec<T extends Spec>(spec: T): T {
  if (!spec?.elements) return spec;
  const elements: Record<string, El> = {};
  for (const [id, el] of Object.entries(spec.elements)) {
    const { watch: _watch, on, ...rest } = el;
    const press = on?.press;
    const keep = el.type === "Button" && press && !Array.isArray(press) && press.action === "submit";
    elements[id] = keep ? { ...rest, on: { press: { action: "submit" } } } : rest;
  }
  return { ...spec, elements };
}

/** State paths bound (`$bindState`) by rendered Input/Checkbox/Select elements: the only values a submit may send. */
export function boundFieldPaths(spec: Spec | null | undefined): string[] {
  const paths = new Set<string>();
  for (const el of Object.values(spec?.elements ?? {})) {
    if (!el.type || !FIELD_TYPES.has(el.type)) continue;
    for (const key of BOUND_PROPS) {
      const p = el.props?.[key]?.$bindState;
      if (typeof p === "string" && p.startsWith("/")) paths.add(p);
    }
  }
  return [...paths];
}

/** Reads the bound paths out of the live state snapshot. Keys are the path, not model prose. */
export function boundValues(state: unknown, paths: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const path of paths) {
    let cur: any = state;
    for (const seg of path.split("/").slice(1)) cur = cur != null && typeof cur === "object" ? cur[seg] : undefined;
    if (cur !== undefined) out[path.slice(1).replaceAll("/", ".")] = cur;
  }
  return out;
}

/**
 * Client-side text for a generative-UI "submit": built from the bound input values read from the
 * message's own state (see boundValues), never from the action's params or model-authored prose,
 * so an injected spec can't make a button send text of its choosing.
 */
export function composeUiSubmit(values: unknown): string | null {
  if (!values || typeof values !== "object" || Array.isArray(values)) return null;
  const lines: string[] = [];
  let total = 0;
  for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
    const raw = typeof v === "string" ? v : (JSON.stringify(v) ?? "");
    const line = `${k.slice(0, 100)}: ${raw.slice(0, MAX_VALUE)}`;
    if (total + line.length > MAX_TOTAL) break;
    total += line.length;
    lines.push(line);
  }
  return lines.length ? `Form submitted:\n${lines.join("\n")}` : null;
}
