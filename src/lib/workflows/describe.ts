import type { WorkflowGraph } from "./graph";

type Var = WorkflowGraph["vars"][number];

/** Variables after Apply: the proposal's, each keeping the current non-empty value; the current ones it lacks come after. */
export function mergeVars(current: Var[], proposed: Var[]): Var[] {
  const now = new Map(current.map((v) => [v.key, v.value]));
  return [...proposed.map((v) => ({ ...v, value: now.get(v.key) || v.value })), ...current.filter((v) => !proposed.some((p) => p.key === v.key))];
}

const BY_STATUS: Record<number, string> = {
  400: "Describe the flow you want.",
  403: "This model can't be used for flows here. Pick another model.",
  409: "A flow is already being generated. Wait for it to finish.",
  422: "Couldn't build a flow from that. Rephrase it or pick a stronger model.",
  502: "The model is busy or can't be reached right now. Try again in a moment.",
  504: "The model took too long. Try again or pick a faster model.",
};

/** The plain sentence for a failed generate call: the server's own message when it sent one. */
export function generateErrorMessage(status: number, serverMessage?: unknown): string {
  if (typeof serverMessage === "string" && serverMessage.trim()) return serverMessage;
  return BY_STATUS[status] ?? "Couldn't build a flow. Try again or pick a stronger model.";
}

/** "Preview · 6 cards" (8.9). */
export function previewLabel(graph: WorkflowGraph): string {
  const n = graph.nodes.length;
  return `Preview · ${n} ${n === 1 ? "card" : "cards"}`;
}
