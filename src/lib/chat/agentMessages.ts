/**
 * Agent messaging (phase 6): the `data-agent-message` part, the hop cap, the target list,
 * and how a message reaches the model. Pure; the pane wiring comes later.
 */

import { fenceText } from "@/lib/chat/quotePastChat";

export const AGENT_MESSAGE_PART = "data-agent-message";
/** Agent messages per user send, across all panes. */
export const MAX_AGENT_HOPS = 3;
const TITLE_MAX = 80;
const ID_MAX = 64;
/** A pane or chat id: letters, digits, `_` and `-`. */
export const ID_RE = /^[\w-]{1,64}$/;

/** A title as the model reads it: one line, no quotes. */
export const promptTitle = (title: string): string => title.replace(/[\r\n]+/g, " ").replace(/["`]/g, "'").trim();

export type AgentSender = "chat" | "side" | "parent" | "workflow";
export type AgentPaneKind = "chat" | "side" | "subagent";

export interface AgentMessageData {
  from: AgentSender;
  fromConversationId: string;
  fromTitle: string;
  hop: number;
}

export interface AgentMessagePart {
  type: typeof AGENT_MESSAGE_PART;
  data: AgentMessageData;
}

export interface AgentPane {
  id: string;
  title: string;
  kind: AgentPaneKind;
}

export interface AgentTarget {
  id: string;
  title: string;
}

const SENDERS: readonly AgentSender[] = ["chat", "side", "parent", "workflow"];

export function buildAgentMessagePart(data: AgentMessageData): AgentMessagePart {
  const { from, fromConversationId, fromTitle, hop } = data;
  return { type: AGENT_MESSAGE_PART, data: { from, fromConversationId, fromTitle, hop } };
}

/** The part's data, or null when the part is not a well-formed agent message. */
export function parseAgentMessagePart(part: unknown): AgentMessageData | null {
  const p = part as { type?: unknown; data?: unknown } | null;
  if (p?.type !== AGENT_MESSAGE_PART || !p.data || typeof p.data !== "object") return null;
  const { from, fromConversationId, fromTitle, hop } = p.data as Record<string, unknown>;
  if (!SENDERS.includes(from as AgentSender)) return null;
  if (typeof fromConversationId !== "string" || typeof fromTitle !== "string") return null;
  if (typeof hop !== "number" || !Number.isInteger(hop) || hop < 1) return null;
  return {
    from: from as AgentSender,
    fromConversationId: fromConversationId.slice(0, ID_MAX),
    fromTitle: fromTitle.slice(0, TITLE_MAX),
    hop,
  };
}

/** Most open panes the browser may list for the model (the pane limit). */
export const MAX_OPEN_PANES = 3;
const PANE_KINDS: readonly AgentPaneKind[] = ["chat", "side", "subagent"];

/**
 * The request's `openPanes`: undefined or null is none; anything malformed (including an id outside
 * ID_RE) is null, and the request is refused. A title is cut to 80 characters.
 */
export function parseOpenPanes(value: unknown): AgentPane[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_OPEN_PANES) return null;
  const panes: AgentPane[] = [];
  for (const p of value) {
    const { id, title, kind } = (p ?? {}) as Record<string, unknown>;
    if (typeof id !== "string" || !ID_RE.test(id) || typeof title !== "string" || !PANE_KINDS.includes(kind as AgentPaneKind)) {
      return null;
    }
    panes.push({ id, title: title.slice(0, TITLE_MAX), kind: kind as AgentPaneKind });
  }
  return panes;
}

/**
 * Whether a message has an agent part that is malformed or has a hop outside 1..MAX_AGENT_HOPS. Such a
 * request is refused: a dropped part would leave its text reaching the model unframed.
 */
export function agentPartRefused(message: unknown): boolean {
  const parts = (message as { parts?: unknown } | null)?.parts;
  if (!Array.isArray(parts)) return false;
  return parts.some((p: any) => {
    if (p?.type !== AGENT_MESSAGE_PART) return false;
    const data = parseAgentMessagePart(p);
    return !data || !canDeliver(data.hop);
  });
}

/** The sender stored as JSON on a queued row, or null when there is none or it is malformed. */
export function agentFromJson(raw: string | null | undefined): AgentMessageData | null {
  if (!raw) return null;
  try {
    return parseAgentMessagePart({ type: AGENT_MESSAGE_PART, data: JSON.parse(raw) });
  } catch {
    return null;
  }
}

/** Hop of a message sent from a pane whose hop is `paneHop` (0 after the user's own send). */
export function nextHop(paneHop: number): number {
  return paneHop + 1;
}

/** Whether a message with this hop may still go out. */
export function canDeliver(hop: number): boolean {
  return Number.isInteger(hop) && hop >= 1 && hop <= MAX_AGENT_HOPS;
}

/**
 * The chats a model may message: other open chats, never its own pane or a sub-agent transcript.
 * Models without tools get none.
 */
export function sendToChatTargets(
  panes: AgentPane[],
  selfId: string,
  supportsTools: boolean,
): AgentTarget[] {
  if (!supportsTools) return [];
  return panes
    .filter((p) => p.id !== selfId && p.kind !== "subagent" && ID_RE.test(p.id))
    .map((p) => ({ id: p.id, title: promptTitle(p.title) || (p.kind === "side" ? "Side chat" : "Untitled chat") }));
}

/** Resolve the `to` argument: an id first, then an exact title (case-insensitive). */
export function resolveAgentTarget(
  to: string,
  targets: AgentTarget[],
): { target: AgentTarget } | { error: string } {
  const byId = targets.find((t) => t.id === to);
  if (byId) return { target: byId };
  const key = to.trim().toLowerCase();
  const byTitle = targets.filter((t) => t.title.trim().toLowerCase() === key);
  if (byTitle.length === 1) return { target: byTitle[0] };
  if (byTitle.length > 1) return { error: `More than one open chat is called "${to.trim()}". Use its id.` };
  return { error: "That chat is not open." };
}

/** Who sent it, by title; untitled senders get a name from their kind. */
export function senderName(d: Pick<AgentMessageData, "from" | "fromTitle">): string {
  const title = promptTitle(d.fromTitle);
  if (title) return title;
  if (d.from === "side") return "side chat";
  if (d.from === "parent") return "the main chat's assistant";
  if (d.from === "workflow") return "a workflow";
  return "another chat";
}

/** Badge text such as `From "Pricing research"`. A title longer than `max` is cut with an ellipsis. */
export function agentBadgeText(d: Pick<AgentMessageData, "from" | "fromTitle">, max = Infinity): string {
  // A sub-agent's follow-up is badged by its role, whatever title its run carries.
  if (d.from === "parent") return "From the main chat's assistant";
  const title = d.fromTitle.trim();
  if (!title) return `From ${senderName(d)}`;
  const shown = title.length > max ? `${title.slice(0, max)}…` : title;
  return `From "${shown}"`;
}

/**
 * What the receiving model reads in place of the part: its sender, that it is not the user, and the
 * text, fenced so a body cannot forge a header or a `User:` line.
 */
export function agentMessageModelText(d: AgentMessageData, body: string): string {
  const who =
    d.from === "parent"
      ? "(the main chat, not the user)"
      : d.from === "workflow"
        ? "(a DevChat workflow run, not the user)"
        : "(another chat, not the user; reply only through sendToChat)";
  return `Message from ${senderName(d)} ${who}:\n${fenceText(body)}`;
}

/**
 * Replay: the agent-message part is dropped and every text part of the message becomes framed model
 * text (`convertToModelMessages` would otherwise drop the part). With no text, the header stays alone.
 */
export function frameAgentMessageParts(parts: unknown): unknown {
  if (!Array.isArray(parts) || !parts.some((p) => p?.type === AGENT_MESSAGE_PART)) return parts;
  const data = parts.map((p) => parseAgentMessagePart(p)).find((d) => d !== null);
  const rest = parts
    .filter((p) => p?.type !== AGENT_MESSAGE_PART)
    .map((p) => (data && p?.type === "text" ? { ...p, text: agentMessageModelText(data, p.text) } : p));
  return data && !rest.some((p) => p?.type === "text")
    ? [{ type: "text", text: agentMessageModelText(data, "") }, ...rest]
    : rest;
}
