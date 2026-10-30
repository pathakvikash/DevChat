/** Sidebar rows with forks nested under the chat they were forked from. Pure, no React. */

export const MAX_TREE_DEPTH = 3;

export interface TreeItem {
  id: string;
  forkedFromId?: string | null;
  createdAt: string;
  pinned?: boolean;
}

export interface TreeRow<T extends TreeItem> {
  item: T;
  /** 0 for a top-level row; forks nest up to MAX_TREE_DEPTH, deeper ones stay at that level. */
  depth: number;
  /** The last row of its group. True for top-level rows, which draw no line. */
  isLastChild: boolean;
  /** For levels 1..depth-1: whether the line of the ancestor at that level runs on past this row. */
  through: boolean[];
}

/**
 * Orders `items` (already filtered, newest activity first) so each fork follows its parent, oldest fork first.
 * Pinned rows go first (a stable sort), as the server lists them, so a chat pinned just now moves up at once.
 * A fork whose parent is not in `items`, or a pinned fork of an unpinned parent, stays top-level.
 * Top-level rows keep their input order. A forkedFromId cycle never loops or drops a row: the first
 * member in input order is shown as a top-level row.
 */
export function buildSidebarTree<T extends TreeItem>(input: T[], opts: { flat?: boolean } = {}): TreeRow<T>[] {
  const items = [...input].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  const byId = new Map(items.map((item) => [item.id, item]));
  const index = new Map(items.map((item, i) => [item.id, i]));
  const kids = new Map<string, T[]>();
  const roots: T[] = [];
  for (const item of items) {
    const parent = item.forkedFromId ? byId.get(item.forkedFromId) : undefined;
    if (opts.flat || !parent || parent === item || (item.pinned && !parent.pinned)) {
      roots.push(item);
    } else {
      const list = kids.get(parent.id) ?? [];
      list.push(item);
      kids.set(parent.id, list);
    }
  }
  const created = (item: T) => Date.parse(item.createdAt);
  for (const list of kids.values()) {
    list.sort((a, b) => created(a) - created(b) || index.get(a.id)! - index.get(b.id)!);
  }

  const seen = new Set<string>();
  const order: Array<{ item: T; depth: number }> = [];
  const walk = (item: T, depth: number) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    order.push({ item, depth: Math.min(depth, MAX_TREE_DEPTH) });
    for (const child of kids.get(item.id) ?? []) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  // Only a cycle (or a fork hanging off one) is left; show each remaining chat once.
  for (const item of items) walk(item, 0);

  // Backwards, so each row knows if a later row sits at its level, or an ancestor's, before the group ends.
  const more: boolean[] = new Array(MAX_TREE_DEPTH + 1).fill(false);
  const rows: TreeRow<T>[] = [];
  for (let i = order.length - 1; i >= 0; i--) {
    const { item, depth } = order[i];
    rows.push({
      item,
      depth,
      isLastChild: depth === 0 || !more[depth],
      through: more.slice(1, depth),
    });
    if (depth > 0) more[depth] = true;
    for (let level = depth + 1; level <= MAX_TREE_DEPTH; level++) more[level] = false;
  }
  return rows.reverse();
}
