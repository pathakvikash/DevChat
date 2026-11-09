import { hasCliFolder, reachesOpenWeb, reachesWeb, readsChats, usesMcp } from "./catalog";
import { ancestorsOf, type FlowNode, type WorkflowGraph } from "./graph";

// Which private data a table holds, and who may not send it to the web. All of the kind logic lives here.
// A table's `privateFrom` is a comma-separated set of kinds; empty means public. The classifiers stay in catalog.ts
// (importing this file from there would be a cycle); this file only turns them into kinds.

export const PRIVATE_KINDS = ["chats", "mcp", "folder"] as const;
export type PrivateKind = string;

const KIND_LABEL: Record<string, string> = { chats: "chats", mcp: "MCP", folder: "a folder" };

export const parseKinds = (s: string | null | undefined): PrivateKind[] => [...new Set((s ?? "").split(",").map((k) => k.trim()).filter(Boolean))];
export const joinKinds = (kinds: Iterable<PrivateKind>): string => [...new Set(kinds)].sort().join(",");
/** "chats", "chats and MCP", "chats, MCP and a folder". */
export function kindsText(kinds: PrivateKind[]): string {
  const names = kinds.map((k) => KIND_LABEL[k] ?? k);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The kinds of private data a card reads by itself (not through a table). */
export function privateKindsOf(type: string, config: Record<string, unknown>, defaultModel = ""): PrivateKind[] {
  const out: PrivateKind[] = [];
  if (readsChats(type, config)) out.push("chats");
  if (usesMcp(type, config)) out.push("mcp");
  if (hasCliFolder(type, config, defaultModel)) out.push("folder");
  return out;
}

/** The table a Save card writes to. */
const writesTable = (n: FlowNode): string => (n.type === "table" ? String(n.config.tableId ?? "") : "");
/** Cards that read rows from a table: they are readers of its private kinds. Only Save to table writes to one. */
export const TABLE_READERS = ["table", "pickRows", "sheetSync"];
export const readsTable = (n: FlowNode): string => (TABLE_READERS.includes(n.type) ? String(n.config.tableId ?? "") : "");

/**
 * The kinds each table would hold once this graph has run its Save cards: what the tables hold now, plus the kinds of
 * every private reader before a Save card, where a card on a private table is itself a reader of that table's kinds
 * (so a copy into a second table inherits them). Repeats until nothing grows, which also covers copies of copies.
 */
export function planKinds(graph: WorkflowGraph, current: Map<string, PrivateKind[]>): Map<string, PrivateKind[]> {
  const kinds = new Map([...current].map(([id, k]) => [id, new Set(k)]));
  const readsOf = (id: string): Set<PrivateKind> => {
    const out = new Set<PrivateKind>();
    for (const a of ancestorsOf(graph, id)) {
      const m = graph.nodes.find((x) => x.id === a);
      if (!m) continue;
      for (const k of privateKindsOf(m.type, m.config, graph.defaultModel)) out.add(k);
      for (const k of kinds.get(readsTable(m)) ?? []) out.add(k);
    }
    return out;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const n of graph.nodes) {
      // Only a Save card fills a table; a Pick rows card reads one, so it adds nothing to it.
      const t = writesTable(n);
      if (!t || !kinds.has(t)) continue;
      const mine = kinds.get(t)!;
      for (const k of readsOf(n.id)) if (!mine.has(k)) (mine.add(k), (changed = true));
    }
  }
  return new Map([...kinds].map(([id, k]) => [id, [...k].sort()]));
}

/**
 * The cards that may not come after a card on a table holding `kinds`. Like a card-level reader, data that came only
 * from MCP may go on to another MCP card (both are servers the user set up) but not to the open web; any other kind may
 * go to neither.
 */
export const webAfter = (graph: WorkflowGraph, id: string, kinds: PrivateKind[]): FlowNode[] => {
  const mcpOnly = kinds.length === 1 && kinds[0] === "mcp";
  const reaches = mcpOnly ? reachesOpenWeb : reachesWeb;
  return graph.nodes.filter((m) => m.id !== id && reaches(m.type, m.config, graph.defaultModel) && ancestorsOf(graph, m.id).has(id));
};

/** The refusal for a card that reads a private table with a web card after it. */
export const privateTableMessage = (table: string, kinds: PrivateKind[], web: FlowNode): string =>
  `“${table}” holds private data (it was filled from ${kindsText(kinds)}), and ${web.ui.label || web.id} reaches the web after a card that reads it. Split them into two workflows, so a web page can't make it send that data out.`;
