export interface MentionContent {
  path: string;
  /** null when the file could not be read (deleted, refused, binary). */
  content: string | null;
}

export interface CutFile {
  path: string;
  /** The text that will be sent; null when the file could not be read. */
  text: string | null;
  kept: number;
  total: number;
  cut: boolean;
}

const CUT_MARKER = "…cut…";

/** How much of a file is sent, as words: "first 180 of 694 lines", or "part of 1 line" for a one-line file. */
export function cutDetail(kept: number, total: number): string {
  return total === 1 ? "part of the only line" : `first ${kept} of ${total} lines`;
}

/** Cut notes in a sent message (written by composeFileBlocks), for the sent bubble. */
export function cutNotesIn(text: string): { path: string; detail: string }[] {
  const pattern = /^File: (.+)$((?:(?!^File: )[\s\S])*?)^\(cut: (first \d+ of \d+ lines|part of the only line)\)$/gm;
  return [...text.matchAll(pattern)].map((m) => ({ path: m[1], detail: m[3] }));
}

/** The `@` query under the caret: an `@` at the start of a word, with no space after it. `a@b` is not a mention. */
export function findMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(?:^|\s)@([^\s@]*)$/.exec(before);
  if (!match) return null;
  return { start: before.length - match[1].length - 1, query: match[1] };
}

/** Files whose path contains the query (case-insensitive), at most `limit`. */
export function matchMentionFiles<T extends { path: string }>(files: T[], query: string, limit = 50): T[] {
  const q = query.toLowerCase();
  return files.filter((f) => f.path.toLowerCase().includes(q)).slice(0, limit);
}

/** Byte count for the picker, e.g. "812 B", "4.2 KB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A backtick fence longer than any backtick run in the content, so the file cannot end the block early. */
export function fenceFor(content: string): string {
  const longest = Math.max(0, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longest + 1));
}

function linesOf(text: string): number {
  return text === "" ? 0 : text.replace(/\n$/, "").split("\n").length;
}

/**
 * What each picked file keeps of the budget (tokens, split evenly). A file over its share keeps
 * whole lines only. Used both for the chip note and for the text sent.
 */
export async function cutFiles(files: MentionContent[], budget: number): Promise<CutFile[]> {
  if (files.length === 0) return [];
  // Loaded on first use, so the tokenizer stays out of the page's first load.
  const { cutTokens } = await import("@/lib/tokens");
  const share = Math.floor(budget / files.length);
  return files.map(({ path, content }) => {
    if (content === null) return { path, text: null, kept: 0, total: 0, cut: false };
    const cut = cutTokens(content, share);
    if (cut === content) return { path, text: content, kept: linesOf(content), total: linesOf(content), cut: false };
    const body = cut.endsWith(CUT_MARKER) ? cut.slice(0, -CUT_MARKER.length) : cut;
    const total = linesOf(content);
    // A one-line file has no whole line to keep, so its part is sent as it is.
    const text = total === 1 ? body : body.slice(0, body.lastIndexOf("\n") + 1).replace(/\n$/, "");
    return { path, text, kept: linesOf(text), total, cut: true };
  });
}

/** One block per file with a path header, for the text sent to the model. */
export async function composeFileBlocks(files: MentionContent[], budget: number): Promise<string> {
  const cuts = await cutFiles(files, budget);
  return cuts
    .map(({ path, text, kept, total, cut }) => {
      if (text === null) return `could not read ${path}`;
      const fence = fenceFor(text);
      const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1] ?? "";
      const lines = [`File: ${path}`, `${fence}${ext}`, text, fence];
      if (cut) lines.push(`(cut: ${cutDetail(kept, total)})`);
      return lines.join("\n");
    })
    .join("\n\n");
}
