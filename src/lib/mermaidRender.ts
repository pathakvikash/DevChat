// The one place that loads and runs mermaid (chat diagrams and the artifact viewer both use it).

export type MermaidTheme = "dark" | "light";

let queue: Promise<unknown> = Promise.resolve();
let counter = 0;

type Opts = { theme: MermaidTheme; securityLevel: "strict" | "loose" };

// Mermaid's own secure list (keys a %%{init}%% directive may not change), plus the keys that restyle the whole app:
// themeCSS (@keyframes and any CSS) and the font families (CSS declarations). Mermaid 11.16 merges `secure` with its
// defaults; the explicit list keeps this safe if that ever changes.
const SECURE_KEYS = ["secure", "securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "maxEdges", "themeCSS", "fontFamily", "altFontFamily"];

// DOMPurify keeps these in labels even under strict: a label could draw a password form that posts elsewhere, a link
// or an image map. They are unwrapped through the DOM (a regex on the string misparses attributes). Inside the SVG
// namespace the children stay; HTML elements (labels are foreignObject HTML) become their text.
export function stripInteractive(svg: string): string {
  const t = document.createElement("template");
  t.innerHTML = svg;
  t.content.querySelectorAll("form,input,button,textarea,select,a,area,map").forEach((n) =>
    n.namespaceURI === "http://www.w3.org/2000/svg" ? n.replaceWith(...n.childNodes) : n.replaceWith(n.textContent ?? ""),
  );
  return t.innerHTML;
}

type Entry = { id: string; svg: string };
const cache = new Map<string, Entry>(); // oldest first; ponytail: 100 diagrams, plain FIFO eviction
const keyOf = (source: string, o: Opts) => `${o.securityLevel}|${o.theme}|${source}`;

/** The entry's SVG with a fresh id: its marker and gradient ids are prefixed with it, so two copies on one page must not share it. */
export const withFreshIds = (e: Entry): string => e.svg.replace(new RegExp(`${e.id}(?!\\d)`, "g"), `mermaid-${++counter}`);

/** The SVG for this source if it was drawn before (a remounted block shows it with no flash of code). */
export const cachedSvg = (source: string, o: Opts): string | undefined => {
  const e = cache.get(keyOf(source, o));
  return e && withFreshIds(e);
};

/**
 * Renders mermaid source to an SVG string. Loaded lazily; mermaid's config is global, so renders run one at a time
 * with their own config. Rejects with mermaid's parse error. Both callers use "strict" (mermaid's sanitising stays
 * on); `%%{init}%%` cannot change securityLevel, themeCSS or the fonts. `isCancelled` lets a queued job for an
 * unmounted or stale block be skipped.
 */
export function renderMermaid(source: string, opts: Opts, isCancelled: () => boolean = () => false): Promise<string> {
  const run = async () => {
    const hit = cachedSvg(source, opts);
    if (hit) return hit;
    if (isCancelled()) throw new Error("cancelled");
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({
      startOnLoad: false,
      theme: opts.theme === "dark" ? "dark" : "default",
      securityLevel: opts.securityLevel,
      suppressErrorRendering: true,
      ...(opts.securityLevel === "strict" && { secure: SECURE_KEYS }),
    });
    const id = `mermaid-${++counter}`;
    try {
      let svg = (await mermaid.render(id, source)).svg;
      if (opts.securityLevel === "strict") svg = stripInteractive(svg);
      cache.set(keyOf(source, opts), { id, svg });
      if (cache.size > 100) cache.delete(cache.keys().next().value!);
      return svg;
    } finally {
      document.getElementById(`d${id}`)?.remove(); // mermaid leaves its scratch node behind on a parse error
    }
  };
  const result = queue.then(run);
  queue = result.catch(() => {});
  return result;
}

const stripQuote = (s: string) => s.replace(/^(?:[ \t]*>)*[ \t]*/gm, "");
/** Compares fence bodies ignoring the list indent and quote marks that markdown removes before the code sees them. */
export const sameFence = (a: string, b: string | null) => b !== null && stripQuote(a) === stripQuote(b);

/** The body of a ``` fence that is still open at the end of `content` (streaming), or null when all fences are closed. */
export function openFenceBody(content: string): string | null {
  let open: { fence: string; start: number } | null = null;
  let pos = 0;
  for (const line of content.split("\n")) {
    const m = /^(?:[ \t]*>)*[ \t]*(`{3,}|~{3,})/.exec(line);
    if (m && !open) open = { fence: m[1], start: pos + line.length + 1 };
    else if (m && open && m[1][0] === open.fence[0] && m[1].length >= open.fence.length && stripQuote(line).trim() === m[1]) open = null;
    pos += line.length + 1;
  }
  return open ? content.slice(open.start).replace(/\n$/, "") : null;
}

const KINDS: Record<string, string> = {
  graph: "Flowchart",
  flowchart: "Flowchart",
  sequencediagram: "Sequence",
  classdiagram: "Class",
  statediagram: "State",
  "statediagram-v2": "State",
  erdiagram: "Entity relationship",
  gantt: "Gantt",
  pie: "Pie",
  journey: "Journey",
  mindmap: "Mind map",
  timeline: "Timeline",
};

/** "Flowchart diagram" for the diagram's aria-label; falls back to "Mermaid diagram". */
export function diagramLabel(source: string): string {
  const first = source.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("%%")) ?? "";
  const kind = KINDS[first.split(/[\s{]/)[0].toLowerCase()];
  return kind ? `${kind} diagram` : "Mermaid diagram";
}

/** "Parse error on line 3:" plus the "Expecting ..." line of a mermaid parse error, without the caret art. */
export function errorSummary(e: unknown): string {
  const lines = (e instanceof Error ? e.message : String(e)).split("\n").map((l) => l.trim()).filter(Boolean);
  const parts = [lines.find((l) => /^Parse error/i.test(l)), lines.find((l) => /^Expecting/i.test(l))].filter(Boolean);
  return (parts.length ? parts.join(" ") : lines[0]) ?? "Unknown error";
}
