export interface QuoteCard {
  id: string;
  text: string;
  instruction: string;
}

/** Drops blank lines and trailing space but keeps the first line's indentation (code). */
export function trimQuote(text: string): string {
  return text.replace(/^(?:[ \t]*\r?\n)+/, "").trimEnd();
}

/** Plain-markdown message: each quote as a `>` block, its instruction, then what was typed. */
export function composeQuoteMessage(
  quotes: Pick<QuoteCard, "text" | "instruction">[],
  typed: string,
): string {
  if (quotes.length === 0) return typed;
  const blocks = quotes.map(({ text, instruction }) => {
    const quote = trimQuote(text)
      .split(/\r?\n/)
      .map((line) => `> ${line}`.trimEnd())
      .join("\n");
    return instruction.trim() ? `${quote}\n\n${instruction.trim()}` : quote;
  });
  if (typed.trim()) blocks.push(typed.trim());
  return blocks.join("\n\n");
}

export type QuoteSegment = { type: "quote" | "text"; text: string };

/** Splits a user message into `>` quote runs and the plain text around them. */
export function splitQuoteBlocks(text: string): QuoteSegment[] {
  const lines = text.split("\n");
  if (!lines.some((l) => l.startsWith(">"))) return [{ type: "text", text }];

  const segments: QuoteSegment[] = [];
  let current: QuoteSegment | null = null;
  for (const line of lines) {
    const isQuote = line.startsWith(">");
    const type = isQuote ? "quote" : "text";
    if (!current || current.type !== type) {
      current = { type, text: "" };
      segments.push(current);
    } else {
      current.text += "\n";
    }
    current.text += isQuote ? line.replace(/^> ?/, "") : line;
  }
  // Blank lines that only separated a quote from its neighbours aren't content.
  return segments
    .map((s) => (s.type === "text" ? { ...s, text: s.text.replace(/^\n+|\n+$/g, "") } : s))
    .filter((s) => s.text !== "");
}
