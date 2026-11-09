// The one place that loads and runs mermaid (chat diagrams and the artifact viewer both use it).

export type MermaidTheme = "dark" | "light";

let queue: Promise<unknown> = Promise.resolve();
let counter = 0;

/**
 * Renders mermaid source to an SVG string. Loaded lazily; mermaid's config is global, so renders run one at a time
 * with their own config. Rejects with mermaid's parse error. `strict` keeps mermaid's sanitising on (chat); the
 * artifact viewer asks for `loose`. `%%{init}%%` cannot change securityLevel: mermaid lists it as a secure key.
 */
export function renderMermaid(
  source: string,
  opts: { theme: MermaidTheme; securityLevel: "strict" | "loose" },
): Promise<string> {
  const run = async () => {
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({
      startOnLoad: false,
      theme: opts.theme === "dark" ? "dark" : "default",
      securityLevel: opts.securityLevel,
      suppressErrorRendering: true,
    });
    const id = `mermaid-${++counter}`;
    try {
      return (await mermaid.render(id, source)).svg;
    } finally {
      document.getElementById(`d${id}`)?.remove(); // mermaid leaves its scratch node behind on a parse error
    }
  };
  const result = queue.then(run);
  queue = result.catch(() => {});
  return result;
}

/** The body of a ``` fence that is still open at the end of `content` (streaming), or null when all fences are closed. */
export function openFenceBody(content: string): string | null {
  let open: { fence: string; start: number } | null = null;
  let pos = 0;
  for (const line of content.split("\n")) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (m) {
      if (!open) open = { fence: m[1], start: pos + line.length + 1 };
      else if (m[1][0] === open.fence[0] && m[1].length >= open.fence.length && line.trim() === m[1]) open = null;
    }
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

/** First non-empty line of a parser error. */
export const firstErrorLine = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).split("\n").map((l) => l.trim()).find(Boolean) ?? "Unknown error";
