import { readsChats, reachesWeb } from "./catalog";
import { ancestorsOf, type FlowNode, type WorkflowGraph } from "./graph";

// Which private data a table holds, and who may not send it to the web. All of the kind logic lives here.
// A table's `privateFrom` is a comma-separated set of kinds; empty means public. Phase 6 adds "mcp" and "folder".

export const PRIVATE_KINDS = ["chats"] as const;
export type PrivateKind = string;

const KIND_LABEL: Record<string, string> = { chats: "chats", mcp: "MCP", folder: "a folder" };

export const parseKinds = (s: string | null | undefined): PrivateKind[] => [...new Set((s ?? "").split(",").map((k) => k.trim()).filter(Boolean))];
export const joinKinds = (kinds: Iterable<PrivateKind>): string => [...new Set(kinds)].sort().join(",");
/** "chats", "chats and MCP", "chats, MCP and a folder". */
export function kindsText(kinds: PrivateKind[]): string {
  const names = kinds.map((k) => KIND_LABEL[k] ?? k);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The kinds of private data a card reads by itself (not through a table). Phase 6 adds MCP and a CLI folder here. */
export function privateKindsOf(type: string, config: Record<string, unknown>): PrivateKind[] {
  return readsChats(type, config) ? ["chats"] : [];
}

const tableIdOf = (n: FlowNode): string => (n.type === "table" ? String(n.config.tableId ?? "") : "");

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
      for (const k of privateKindsOf(m.type, m.config)) out.add(k);
      for (const k of kinds.get(tableIdOf(m)) ?? []) out.add(k);
    }
    return out;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const n of graph.nodes) {
      const t = tableIdOf(n);
      if (!t || !kinds.has(t)) continue;
      const mine = kinds.get(t)!;
      for (const k of readsOf(n.id)) if (!mine.has(k)) (mine.add(k), (changed = true));
    }
  }
  return new Map([...kinds].map(([id, k]) => [id, [...k].sort()]));
}

/** The cards that reach the web somewhere after this one. */
export const webAfter = (graph: WorkflowGraph, id: string): FlowNode[] =>
  graph.nodes.filter((m) => m.id !== id && reachesWeb(m.type, m.config) && ancestorsOf(graph, m.id).has(id));

/** The refusal for a card that reads a private table with a web card after it. */
export const privateTableMessage = (table: string, kinds: PrivateKind[], web: FlowNode): string =>
  `“${table}” holds private data (it was filled from ${kindsText(kinds)}), and ${web.ui.label || web.id} reaches the web after a card that reads it. Split them into two workflows, so a web page can't make it send that data out.`;
