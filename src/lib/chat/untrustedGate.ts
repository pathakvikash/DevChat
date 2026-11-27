import { isAppToolId } from "@/lib/apps/chatTools";

type Msg = { role?: string; content?: unknown };
type Part = { type?: string; text?: unknown; toolName?: unknown } | null | undefined;

/** Parsed, normalised form (default ports, host case, no #fragment). Null when it is not an http(s) URL. */
export function normUrl(s: string): string | null {
  try {
    const u = new URL(s.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

const textOf = (m: Msg): string =>
  typeof m.content === "string"
    ? m.content
    : Array.isArray(m.content)
      ? (m.content as Part[]).map((p) => (p?.type === "text" && typeof p.text === "string" ? p.text : "")).join("\n")
      : "";

/** True only when `url` is, after normalising, exactly a URL the user typed in this conversation. A lookalike host,
 *  a longer path or an appended query is a different URL and does not match. */
export function userSentUrl(messages: readonly Msg[] | undefined, url: unknown): boolean {
  const want = typeof url === "string" ? normUrl(url) : null;
  if (!want) return false;
  for (const m of messages ?? []) {
    if (m.role !== "user") continue;
    for (const raw of textOf(m).match(/https?:\/\/[^\s<>"'`]+/gi) ?? []) {
      // Sentence punctuation and a closing bracket are not part of the link the user meant.
      if (normUrl(raw.replace(/[.,;:!?)\]}]+$/, "")) === want) return true;
    }
  }
  return false;
}

/** A result with text from outside is in the conversation: a fetched page, web search, MCP or app tool. */
export function hasExternalText(messages: readonly Msg[] | undefined): boolean {
  return (messages ?? []).some(
    (m) =>
      m.role === "tool" &&
      Array.isArray(m.content) &&
      (m.content as Part[]).some((p) => {
        const n = p?.type === "tool-result" ? String(p.toolName ?? "") : "";
        return n === "fetchUrl" || n === "webSearch" || n.startsWith("mcp_") || isAppToolId(n);
      }),
  );
}
