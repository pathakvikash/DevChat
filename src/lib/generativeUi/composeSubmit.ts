const MAX_VALUE = 2000;
const MAX_TOTAL = 8000;

/**
 * Client-side text for a generative-UI "submit": built from the bound values only,
 * never from model-authored prose, so an injected spec can't make a button say
 * something different from what it sends.
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
