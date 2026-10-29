import { countTokens, cutTokens } from "@/lib/tokens";
import { normalizeToolParts } from "@/lib/chat/normalizeToolParts";
import { isToolPart } from "@/lib/utils/messageParts";

/** Longest tool input or result kept in a rendered transcript. */
const TOOL_CUT = 1000;
/** Tokens kept back for the "Showing the last…" note. */
const NOTE_TOKENS = 16;

export interface TranscriptMessage {
  role: string;
  content?: string;
  /** Saved parts: an array, or the JSON string stored in the DB. */
  parts?: unknown;
}

function show(value: unknown): string {
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  return text.length > TOOL_CUT ? `${text.slice(0, TOOL_CUT)}…cut…` : text;
}

/**
 * A saved message's parts with duplicate tool parts merged (the stored shape holds each
 * call twice, from the UI parts and again from the steps). Null when there are none.
 */
export function partsOf(m: TranscriptMessage): any[] | null {
  let parts = m.parts;
  if (typeof parts === "string") {
    try {
      parts = JSON.parse(parts);
    } catch {
      return null;
    }
  }
  return Array.isArray(parts) ? (normalizeToolParts(parts) as any[]) : null;
}

function renderMessage(m: TranscriptMessage): string {
  const label = m.role === "user" ? "User" : "Assistant";
  const parts = partsOf(m);
  if (!parts) return `${label}: ${m.content ?? ""}`;
  const lines = parts.flatMap((p) => {
    if (p?.type === "text") return p.text ? [p.text as string] : [];
    if (!isToolPart(p)) return [];
    const result = p.errorText ? `error: ${p.errorText}` : show(p.output);
    return [`[tool ${p.type.slice(5)} ${show(p.input)} → ${result}]`];
  });
  return `${label}: ${lines.join("\n")}`;
}

/**
 * Plain-text transcript that fits `budgetTokens`: the `header` always stays, the
 * oldest messages go first, and the newest always stays (cut to fit if it must).
 * `total` is the chat's message count when `messages` is only its newest slice.
 */
export function renderTranscript(
  messages: TranscriptMessage[],
  {
    budgetTokens,
    header = "",
    total = messages.length,
  }: { budgetTokens: number; header?: string; total?: number },
): { text: string; shown: number; total: number } {
  let left = budgetTokens - countTokens(header) - NOTE_TOKENS;
  const blocks: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const raw = renderMessage(messages[i]);
    // The newest message stays whatever its size; older ones only if they fit whole.
    const block = blocks.length === 0 ? cutTokens(raw, Math.max(left - 1, 0)) : raw;
    const cost = countTokens(block) + 1; // +1 for the blank line between blocks
    if (cost > left && blocks.length > 0) break;
    left -= cost;
    blocks.push(block);
  }
  blocks.reverse();
  const note = blocks.length < total ? `Showing the last ${blocks.length} of ${total} messages.` : "";
  const text = [header, note, ...blocks].filter(Boolean).join("\n\n");
  return { text, shown: blocks.length, total };
}
