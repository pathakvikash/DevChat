/**
 * Best-effort extraction of a JSON value from raw model text. Local models
 * frequently wrap JSON in ```json fences, prepend prose ("Sure, here is…"),
 * or emit a trailing stop token. This finds the first balanced {...} or
 * [...] span and parses it, returning `fallback` if nothing parses.
 */
export function extractJson<T = unknown>(text: string, fallback: T): T {
  if (!text) return fallback;

  // 1. Try a fenced code block first.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates: string[] = [];
  if (fence) candidates.push(fence[1]);
  candidates.push(text);

  for (const c of candidates) {
    const direct = tryParse<T>(c.trim());
    if (direct !== undefined) return direct;
    const span = balancedSpan(c);
    if (span) {
      const parsed = tryParse<T>(span);
      if (parsed !== undefined) return parsed;
    }
  }
  return fallback;
}

function tryParse<T>(s: string): T | undefined {
  if (!s) return undefined;
  try {
    return JSON.parse(s) as T;
  } catch {
    return undefined;
  }
}

/** Find the first balanced {...} or [...] region in the string. */
function balancedSpan(text: string): string | null {
  const startObj = text.indexOf("{");
  const startArr = text.indexOf("[");
  let start = -1;
  if (startObj === -1) start = startArr;
  else if (startArr === -1) start = startObj;
  else start = Math.min(startObj, startArr);
  if (start === -1) return null;

  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
