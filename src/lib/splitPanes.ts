/** Split view state: which chats are open, their order, and the focused one. Pure, no React. */

export const SPLIT_MIN_PX = 360;
export const SPLIT_DIVIDER_PX = 6;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** `/c/<first>?split=<id,id>&focus=<id>` → open chats in order, and the focused one. */
export function parsePanes(pathname: string, params: URLSearchParams): { ids: string[]; focus: string } {
  const first = /^\/c\/([^/?#]+)$/.exec(pathname)?.[1];
  if (!first || first === "new" || !ID_PATTERN.test(first)) return { ids: [], focus: "" };
  const ids = [first];
  for (const raw of (params.get("split") ?? "").split(",")) {
    const id = raw.trim();
    if (ID_PATTERN.test(id) && !ids.includes(id)) ids.push(id);
  }
  const wanted = params.get("focus") ?? "";
  return { ids, focus: ids.includes(wanted) ? wanted : first };
}

/** Builds the path and query. `focus` is left out when the first pane is focused; other params are kept. */
export function serializePanes(ids: string[], focus: string, keep?: URLSearchParams): string {
  const [first = "new", ...rest] = ids;
  const parts: string[] = [];
  if (rest.length) parts.push(`split=${rest.join(",")}`);
  if (focus !== first && ids.includes(focus)) parts.push(`focus=${focus}`);
  keep?.forEach((value, key) => {
    if (key === "split" || key === "focus") return;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  });
  return `/c/${first}${parts.length ? `?${parts.join("&")}` : ""}`;
}

/** Opening limit by window width: 3 from 1440px, 2 from 768px, else 1. */
export function maxPanesForWidth(windowPx: number): 1 | 2 | 3 {
  if (windowPx < 768) return 1;
  if (windowPx < 1440) return 2;
  return 3;
}

/** True when `count` panes each get `minPx` in `areaPx`. One pane always fits. */
export function fitsSideBySide(count: number, areaPx: number, minPx = SPLIT_MIN_PX): boolean {
  return count <= 1 || count * minPx <= areaPx;
}

export function dividersPx(count: number): number {
  return Math.max(0, count - 1) * SPLIT_DIVIDER_PX;
}

/** Adds `id` beside the pane at `at`. An open chat is left alone; at the limit returns "full". */
export function openPane(
  ids: string[],
  id: string,
  at: { index: number; side: "left" | "right" },
  limit: number,
): string[] | "full" {
  if (ids.includes(id)) return ids;
  if (ids.length >= limit) return "full";
  if (ids.length === 0) return [id];
  const index = Math.min(Math.max(at.index, 0), ids.length - 1);
  const insertAt = at.side === "left" ? index : index + 1;
  return [...ids.slice(0, insertAt), id, ...ids.slice(insertAt)];
}

/**
 * Closes `id`. Closing the focused pane moves focus to its left neighbour, else its right one.
 * Closing the first pane promotes the next one into the path. The last pane is never closed.
 */
export function closePane(ids: string[], id: string, focus = id): { ids: string[]; focus: string } {
  const idx = ids.indexOf(id);
  if (idx < 0 || ids.length <= 1) {
    return { ids: [...ids], focus: ids.includes(focus) ? focus : (ids[0] ?? "") };
  }
  const next = ids.filter((x) => x !== id);
  if (focus !== id && next.includes(focus)) return { ids: next, focus };
  const neighbour = idx > 0 ? ids[idx - 1] : ids[idx + 1];
  return { ids: next, focus: neighbour };
}

/** Swaps `oldId` for `newId` in place. A chat that is already open just gets focus. */
export function replacePane(ids: string[], oldId: string, newId: string): { ids: string[]; focus: string } {
  if (ids.includes(newId)) return { ids: [...ids], focus: newId };
  const idx = ids.indexOf(oldId);
  if (idx < 0) return ids.length ? { ids: [...ids], focus: ids[0] } : { ids: [newId], focus: newId };
  const next = [...ids];
  next[idx] = newId;
  return { ids: next, focus: newId };
}

/** The next (dir 1) or previous (dir -1) pane, wrapping around. */
export function nextPane(ids: string[], focus: string, dir: 1 | -1): string {
  if (ids.length === 0) return "";
  const idx = ids.indexOf(focus);
  if (idx < 0) return ids[0];
  return ids[(idx + dir + ids.length) % ids.length];
}

export function equalShares(count: number): number[] {
  return Array.from({ length: Math.max(0, count) }, () => 1 / count);
}

/** Fractions of `areaPx` with every pane at least `minPx`. Too small an area gives equal shares. */
export function clampWidths(fractions: number[], areaPx: number, minPx = SPLIT_MIN_PX): number[] {
  const n = fractions.length;
  if (n === 0) return [];
  if (areaPx < n * minPx) return equalShares(n);
  const total = fractions.reduce((s, f) => s + Math.max(0, f), 0);
  if (total <= 0) return equalShares(n);
  const f = fractions.map((x) => Math.max(0, x) / total);
  const min = minPx / areaPx;
  const pinned = f.map(() => false);
  for (;;) {
    let found = false;
    f.forEach((x, i) => {
      if (!pinned[i] && x < min) {
        pinned[i] = true;
        f[i] = min;
        found = true;
      }
    });
    if (!found) return f;
    const freeCount = pinned.filter((p) => !p).length;
    if (freeCount === 0) return f;
    const pinnedSum = f.reduce((s, x, i) => (pinned[i] ? s + x : s), 0);
    const freeSum = f.reduce((s, x, i) => (pinned[i] ? s : s + x), 0);
    f.forEach((x, i) => {
      if (!pinned[i]) f[i] = freeSum > 0 ? (x / freeSum) * (1 - pinnedSum) : (1 - pinnedSum) / freeCount;
    });
  }
}

/** Moves the divider after pane `i` by `dxPx`. Only panes i and i+1 change; both keep `minPx`. */
export function resizeDivider(fractions: number[], i: number, dxPx: number, areaPx: number, minPx = SPLIT_MIN_PX): number[] {
  if (areaPx <= 0 || i < 0 || i + 1 >= fractions.length) return [...fractions];
  const min = minPx / areaPx;
  const pair = fractions[i] + fractions[i + 1];
  if (pair < 2 * min) return [...fractions];
  const left = Math.min(Math.max(fractions[i] + dxPx / areaPx, min), pair - min);
  const next = [...fractions];
  next[i] = left;
  next[i + 1] = pair - left;
  return next;
}

export interface PaneActivity {
  streaming: boolean;
  input: string;
  quotes: number;
  files: number;
  queued: number;
}

/** A busy pane holds a reply or unsent work: closing or replacing it asks first. */
export function isPaneBusy(p: PaneActivity): boolean {
  return p.streaming || p.input.trim() !== "" || p.quotes > 0 || p.files > 0 || p.queued > 0;
}

export interface PaneWriter {
  id: string;
  kind: string;
  mode: string;
  workingFolder: string | null;
}

const WRITER_MODES = new Set(["agent", "ask"]);

/** Panes in Agent or Ask mode that share a working folder with another such pane. Side chats never count. */
export function writerConflicts(panes: PaneWriter[]): Set<string> {
  const writers = panes.filter((p) => p.kind !== "side" && WRITER_MODES.has(p.mode) && p.workingFolder);
  const perFolder = new Map<string, number>();
  for (const p of writers) perFolder.set(p.workingFolder!, (perFolder.get(p.workingFolder!) ?? 0) + 1);
  return new Set(writers.filter((p) => perFolder.get(p.workingFolder!)! > 1).map((p) => p.id));
}

/** Open side chats whose main chat is `closing`: they close with it. */
export function orphanSides(ids: string[], parentOf: Record<string, string>, closing: string): string[] {
  return ids.filter((id) => id !== closing && parentOf[id] === closing);
}
