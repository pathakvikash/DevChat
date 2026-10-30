/**
 * Where an agent message goes, and how a pane's hop moves. The part format and the hop cap live in
 * lib/chat/agentMessages.ts; SplitView does the wiring.
 */
import { resolveAgentTarget, sendToChatTargets, type AgentPane } from "@/lib/chat/agentMessages";

export const AGENT_NOT_OPEN = "That chat is not open.";
export const AGENT_DELIVERED = "Delivered. It may answer with sendToChat.";

export type AgentRoute = { id: string } | { openSideOf: string } | { error: string };

/** The hop a pane keeps: the larger of its own and the incoming one. */
export function raiseHop(current: number, incoming: number): number {
  return Math.max(current, incoming);
}

/**
 * The panes whose hops start over when `id`'s reply ends: `id` and its exchange partner, once that
 * one is idle too. `partners` is kept when a refusal clears the talk, so the cap's end still finds it.
 */
export function exchangeEnded(id: string, partners: ReadonlyMap<string, string>, isBusy: (id: string) => boolean): string[] {
  const partner = partners.get(id);
  return partner && !isBusy(partner) ? [id, partner] : [];
}

/**
 * Where `to` goes from pane `fromId`: an open chat (id or exact title), or `"side"` for the sender's
 * own side chat, which is opened when it is closed. Refuses the sender itself, closed chats,
 * sub-agent transcripts, and `"side"` from a side chat.
 */
export function routeAgentMessage(
  to: string,
  fromId: string,
  panes: AgentPane[],
  parentOf: Record<string, string>,
): AgentRoute {
  if (to.trim() === "side") {
    if (panes.find((p) => p.id === fromId)?.kind !== "chat") return { error: AGENT_NOT_OPEN };
    const side = panes.find((p) => p.kind === "side" && parentOf[p.id] === fromId);
    return side ? { id: side.id } : { openSideOf: fromId };
  }
  const found = resolveAgentTarget(to, sendToChatTargets(panes, fromId, true));
  return "target" in found ? { id: found.target.id } : { error: found.error };
}
