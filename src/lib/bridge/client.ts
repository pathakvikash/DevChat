// Pure helpers for the page side of the local bridge (no React, no fetch): status mapping, routing, request and save bodies.
import { BRIDGE_MODEL_PREFIX, BRIDGE_PROTOCOL, isBridgeLocalModel, HOST_TOOLS_REFUSED, SERVER_NO_CLI, VERCEL_FOLDERS_REFUSED } from "./constants";
import { isChatMode, type ChatMode } from "@/lib/chat/modes";

export type BridgeStatus = "unpaired" | "offline" | "mismatch" | "no-claude" | "ready" | "blocked";

/** What the /health probe did: the browser refused or failed it, or the bridge (or something else) answered. */
export type ProbeOutcome =
  | { kind: "rejected"; errorName?: string; permissionDenied?: boolean; safariOnHttps?: boolean }
  | { kind: "response"; ok: boolean; body: unknown };

export interface BridgeHealth {
  status: BridgeStatus;
  /** The bridge's protocol number, when it answered (shown with `mismatch`). */
  protocol: number | null;
  version: string | null;
}

/**
 * Maps a probe to a status. A bridge answers /health with only `{ protocol }` when the token is missing or wrong, so an
 * answer without `version` means this page is not paired. Safari blocks an https page from reaching http://127.0.0.1 and
 * reports it as a plain network error, so there it counts as `blocked` rather than `offline`.
 */
export function bridgeStatus(hasToken: boolean, outcome: ProbeOutcome | null): BridgeHealth {
  const none = { protocol: null, version: null };
  if (!hasToken || !outcome) return { status: "unpaired", ...none };
  if (outcome.kind === "rejected") {
    const blocked = outcome.permissionDenied || outcome.safariOnHttps || outcome.errorName === "NotAllowedError" || outcome.errorName === "SecurityError";
    return { status: blocked ? "blocked" : "offline", ...none };
  }
  const body = outcome.body as { protocol?: unknown; version?: unknown } | null;
  if (!outcome.ok || !body || typeof body !== "object" || typeof body.protocol !== "number") return { status: "offline", ...none };
  const version = typeof body.version === "string" ? body.version : null;
  if (body.protocol !== BRIDGE_PROTOCOL) return { status: "mismatch", protocol: body.protocol, version };
  if (!version) return { status: "unpaired", protocol: body.protocol, version: null };
  if ((outcome.body as { claude?: unknown }).claude === false) return { status: "no-claude", protocol: body.protocol, version };
  return { status: "ready", protocol: body.protocol, version };
}

/** The sentence shown for a status that is not `ready`. */
export function bridgeProblemText(status: BridgeStatus, protocol: number | null = null): string | null {
  switch (status) {
    case "unpaired": return "Pair this browser with the bridge: paste its token in Settings > Local bridge.";
    case "offline": return "Start the bridge on this computer: npm run bridge";
    case "mismatch": return `Bridge is version ${protocol ?? "?"}, this Orrery needs ${BRIDGE_PROTOCOL}: git pull, then npm run bridge`;
    case "no-claude": return "Claude Code is not installed on this computer (or not on PATH)";
    case "blocked": return "Your browser blocked access to this computer. Allow local network access for this site, or use Chrome or Firefox";
    default: return null;
  }
}

export const isBridgeModel = (model: string | null | undefined): boolean => !!model && model.startsWith(BRIDGE_MODEL_PREFIX);

type FoldersAnswer = { hostTools: boolean; reason: string | null } | null | undefined;

/**
 * True when the server says it cannot run this user's tools (Vercel, or the user is not the owner), false when it can,
 * null when unknown (not loaded yet). Comes from GET /api/folders.
 */
export function serverHostToolsMissing(folders: FoldersAnswer): boolean | null {
  if (!folders) return null;
  return !folders.hostTools || folders.reason === VERCEL_FOLDERS_REFUSED || folders.reason === HOST_TOOLS_REFUSED || folders.reason === SERVER_NO_CLI;
}

export type Route = { to: "server" } | { to: "bridge" } | { to: "blocked"; status: BridgeStatus; why?: "model-missing" | "server-unknown" };

/**
 * A claude-code/ model goes to the bridge when the server cannot run it itself (deployed) and the bridge is ready. It stays on
 * the server only when the server says it can. Anything unknown or unreachable is blocked: never another model.
 */
export function routeTurn(i: { model: string | null | undefined; noHostTools: boolean | null; status: BridgeStatus }): Route {
  if (!isBridgeModel(i.model) || i.noHostTools === false) return { to: "server" };
  // Unknown (the folder answer never came): never guess "server" for a claude-code model, which would answer with another one.
  if (i.noHostTools === null) return { to: "blocked", status: i.status };
  return i.status === "ready" ? { to: "bridge" } : { to: "blocked", status: i.status };
}

/**
 * An ollama/ or lmstudio/ model. It stays on the server unless a bridge token is stored (everyone else is unchanged) and the
 * server does not itself list that model (Vercel cannot see this computer's Ollama). Then the bridge answers it, if it is
 * ready and lists it: otherwise the send is blocked, because the server would quietly answer with its fallback model.
 */
export function routeLocalTurn(i: { hasToken: boolean; serverHasModel: boolean | null; bridgeHasModel: boolean; status: BridgeStatus }): Route {
  if (!i.hasToken || i.serverHasModel === true) return { to: "server" };
  if (i.serverHasModel === null) return { to: "blocked", status: i.status, why: "server-unknown" };
  if (i.status !== "ready") return { to: "blocked", status: i.status };
  return i.bridgeHasModel ? { to: "bridge" } : { to: "blocked", status: i.status, why: "model-missing" };
}

/** The sentence for a blocked send. */
export function blockedText(r: Extract<Route, { to: "blocked" }>, protocol: number | null): string {
  if (r.why === "model-missing") return "The local bridge does not list this model. Start Ollama or LM Studio on this computer, then try again.";
  return bridgeProblemText(r.status, protocol) ?? "Could not check whether this server can run this model. Reload the page and try again.";
}

// ─── Request body for the daemon's /chat ───────────────────────────────────

type Msg = { id?: string; role: string; parts?: unknown[] };
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

export function buildBridgeBody(i: {
  messages: Msg[];
  conversationId: string;
  model: string;
  mode?: string;
  allowedTools?: unknown;
  folder?: string | null;
  effort?: string | null;
  system?: string | null;
}) {
  const mode: ChatMode = isChatMode(i.mode) ? i.mode : "chat";
  return {
    messages: i.messages
      .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
      .slice(-1000)
      .map((m) => ({ id: m.id, role: m.role, parts: m.parts ?? [] })),
    conversationId: i.conversationId.slice(0, 200),
    model: i.model,
    mode,
    allowedTools: Array.isArray(i.allowedTools) ? i.allowedTools.filter((t): t is string => typeof t === "string" && t.length <= 100).slice(0, 50) : [],
    ...(i.folder ? { folder: i.folder.slice(0, 1000) } : {}),
    ...(i.effort && EFFORTS.includes(i.effort) ? { effort: i.effort } : {}),
    ...(i.system ? { system: i.system.slice(0, 64_000) } : {}),
  };
}

// ─── Save body for POST /api/conversations/[id]/messages ───────────────────

const TEXT_MAX = 200_000;
const TOOL_NAME = /^(mcp__[A-Za-z0-9_-]{1,100}|[A-Z][A-Za-z0-9]{0,40})$/;
const TOOL_STATES = ["input-streaming", "input-available", "approval-requested", "approval-responded", "output-available", "output-error", "output-denied"];
type Part = Record<string, unknown>;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);

/** Keeps only what saveBridgeTurn accepts; returns null for a part it would reject (or that must not be stored). */
function cleanAssistantPart(p: Part): Part | null {
  switch (p.type) {
    case "text":
    case "reasoning": return { type: p.type, text: str(p.text, TEXT_MAX) ?? "" };
    case "step-start": return { type: "step-start" };
    case "dynamic-tool": {
      const toolName = str(p.toolName, 200);
      const toolCallId = str(p.toolCallId, 200);
      if (!toolName || !TOOL_NAME.test(toolName) || !toolCallId || typeof p.state !== "string" || !TOOL_STATES.includes(p.state)) return null;
      const a = p.approval as { id?: unknown; approved?: unknown; reason?: unknown } | undefined;
      const approvalId = str(a?.id, 200);
      return {
        type: "dynamic-tool",
        toolName,
        toolCallId,
        state: p.state,
        ...(p.input !== undefined ? { input: p.input } : {}),
        ...(p.output !== undefined ? { output: p.output } : {}),
        ...(str(p.errorText, 20_000) !== undefined ? { errorText: str(p.errorText, 20_000) } : {}),
        ...(approvalId
          ? { approval: { id: approvalId, ...(typeof a?.approved === "boolean" ? { approved: a.approved } : {}), ...(str(a?.reason, 2000) !== undefined ? { reason: str(a?.reason, 2000) } : {}) } }
          : {}),
      };
    }
    default: return null;
  }
}

export interface SavePayload {
  user?: { id: string; text: string; parts: { type: "text"; text: string }[] };
  assistant: { id: string; parts: Part[]; model: string };
  continuing?: true;
}

/**
 * The finished turn as saveBridgeTurn wants it: the newest assistant message, plus the user message before it unless
 * it was already saved. `continuing` (an approval resume) rewrites the same assistant row. Null when there is nothing to save.
 */
export function buildSavePayload(i: { messages: { id: string; role: string; parts?: unknown[] }[]; model: string; continuing: boolean; savedUserIds: ReadonlySet<string> }): SavePayload | null {
  const at = i.messages.length - 1;
  const assistant = i.messages[at];
  if (!assistant || assistant.role !== "assistant") return null;
  // A local model has no tools: the server refuses a tool part in its turn.
  const parts = ((assistant.parts ?? []) as Part[]).map(cleanAssistantPart).filter((p): p is Part => !!p && !(isBridgeLocalModel(i.model) && p.type === "dynamic-tool"));
  if (!parts.length) return null;
  const userMsg = [...i.messages.slice(0, at)].reverse().find((m) => m.role === "user");
  const textParts = userMsg ? ((userMsg.parts ?? []) as Part[]).filter((p) => p.type === "text").slice(0, 50).map((p) => ({ type: "text" as const, text: str(p.text, TEXT_MAX) ?? "" })) : [];
  const user = userMsg && !i.savedUserIds.has(userMsg.id) ? { id: userMsg.id, text: textParts.map((p) => p.text).join("\n\n").slice(0, TEXT_MAX), parts: textParts } : undefined;
  return { ...(user ? { user } : {}), assistant: { id: assistant.id, parts, model: i.model }, ...(i.continuing ? { continuing: true as const } : {}) };
}
