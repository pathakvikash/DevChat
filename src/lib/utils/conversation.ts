/**
 * Pure helpers used by the conversation page to translate between the
 * Prisma-shaped conversation record and the UIMessage[] the chat UI wants.
 *
 * Kept out of `app/c/[id]/page.tsx` so that file stays a thin view+state
 * layer, and so the helpers can be unit-tested in isolation if needed.
 */

interface RawPart {
  type: string;
  text?: string;
  [k: string]: unknown;
}

export interface RawMessage {
  id: string;
  role: string;
  content: string;
  parts: string | null;
  createdAt: string | Date;
  feedback?: { id: string; rating: number } | null;
}

export interface RawConversation {
  messages?: RawMessage[];
  compressedSummary?: string | null;
  compressedAt?: string | Date | null;
  compressedBeforeTokens?: number | null;
  compressedAfterTokens?: number | null;
  compressedBeforeMessages?: number | null;
}

export interface AppMessage {
  id: string;
  role: string;
  parts: RawPart[];
  createdAt: string;
  feedback?: { id: string; rating: number } | null;
}

/**
 * Concatenate the text portions of an AI SDK UIMessage-shaped `parts` array.
 * Returns "" if `parts` is missing or not an array.
 */
export function joinTextParts(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p: any) => p?.type === "text")
    .map((p: any) => p?.text || "")
    .join("");
}

/**
 * Find the last fenced code block whose language is python or javascript,
 * and return its code body. Useful for piping a model's last code snippet
 * into the Scratchpad.
 */
export function extractLatestCode(
  text: string,
): { code: string; lang: "python" | "javascript" } | null {
  if (!text) return null;
  const re = /```(\w+)?\r?\n([\s\S]*?)```/g;
  let last: { code: string; lang: "python" | "javascript" } | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const rawLang = (m[1] || "").toLowerCase();
    let lang: "python" | "javascript" | null = null;
    if (["py", "python"].includes(rawLang)) lang = "python";
    else if (["js", "javascript", "ts", "typescript"].includes(rawLang))
      lang = "javascript";
    if (lang) last = { code: m[2].trim(), lang };
  }
  return last;
}

/**
 * Translate a Prisma conversation record into the UIMessage[] shape that
 * `useChat` expects. Messages older than `compressedAt` are filtered out,
 * and a synthetic "compression" role message is prepended when a summary
 * exists.
 */
export function buildMessagesFromConversation(
  conv: RawConversation,
): AppMessage[] {
  const rawMessages = Array.isArray(conv.messages) ? conv.messages : [];
  const compressedAt = conv.compressedAt ? new Date(conv.compressedAt) : null;

  const visibleMessages = compressedAt
    ? rawMessages.filter((m) => new Date(m.createdAt) >= compressedAt)
    : rawMessages;

  const mapped: AppMessage[] = visibleMessages.map((m) => {
    let parts: RawPart[];
    if (m.parts) {
      try {
        const parsed = JSON.parse(m.parts);
        parts = Array.isArray(parsed) ? parsed : [];
      } catch {
        parts = [{ type: "text", text: m.content }];
      }
    } else {
      parts = [{ type: "text", text: m.content }];
    }
    return {
      id: m.id,
      role: m.role,
      parts,
      feedback: m.feedback ?? null,
      createdAt:
        typeof m.createdAt === "string"
          ? m.createdAt
          : m.createdAt instanceof Date
            ? m.createdAt.toISOString()
            : new Date().toISOString(),
    };
  });

  if (conv.compressedSummary && compressedAt) {
    const beforeTokens = conv.compressedBeforeTokens;
    const afterTokens = conv.compressedAfterTokens;
    const beforeMessages = conv.compressedBeforeMessages;
    const reductionPercent =
      typeof beforeTokens === "number" &&
      typeof afterTokens === "number" &&
      beforeTokens > 0
        ? Math.round(((beforeTokens - afterTokens) / beforeTokens) * 100)
        : undefined;

    mapped.unshift({
      id: `compression-${compressedAt.getTime()}`,
      role: "compression",
      createdAt: compressedAt.toISOString(),
      parts: [
        {
          type: "compression-event",
          summary: conv.compressedSummary,
          compressedAt: compressedAt.toISOString(),
          beforeTokens,
          afterTokens,
          beforeMessages,
          reductionPercent,
        },
      ],
    });
  }

  return mapped;
}
