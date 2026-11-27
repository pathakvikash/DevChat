import { prisma } from "@/lib/db";
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

/** Tools whose result carries text from outside: a page, search, MCP, app, helper or another chat. One list for the live
 *  check (below) and the stored-history check (`storedTaint`). */
export const isExternalTextTool = (n: string): boolean =>
  ["fetchUrl", "webSearch", "runAgent", "messageAgent", "readChat", "searchChats"].includes(n) || n.startsWith("mcp_") || isAppToolId(n);

/** A result with text from outside is in the conversation. */
export function hasExternalText(messages: readonly Msg[] | undefined): boolean {
  return (messages ?? []).some(
    (m) =>
      m.role === "tool" &&
      Array.isArray(m.content) &&
      (m.content as Part[]).some((p) => p?.type === "tool-result" && isExternalTextTool(String(p.toolName ?? ""))),
  );
}

const EXACT = ["fetchUrl", "webSearch", "runAgent", "messageAgent", "readChat", "searchChats"];
/** Substrings of a stored `parts` JSON that mean an external-text tool part (static `tool-<name>` or `dynamic-tool`). */
const STORED_MARKERS = [
  ...EXACT.flatMap((n) => [`"type":"tool-${n}"`, `"toolName":"${n}"`]),
  ...["mcp_", "app_"].flatMap((p) => [`"type":"tool-${p}`, `"toolName":"${p}`]),
];

/** True when any STORED assistant message of this chat has an external-text tool part. Compression drops those results
 *  from the prompt but keeps their text in the summary, so the live check alone would miss them. One indexed query,
 *  `parts` matched in SQL and never loaded; a false positive only means one more card. */
export async function storedTaint(conversationId: string | undefined): Promise<boolean> {
  if (!conversationId) return false;
  const hit = await prisma.message.findFirst({
    where: { conversationId, role: "assistant", OR: STORED_MARKERS.map((contains) => ({ parts: { contains } })) },
    select: { id: true },
  });
  return !!hit;
}
