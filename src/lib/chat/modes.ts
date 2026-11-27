/** Chat · Plan · Ask · Agent. Pure, so the browser and the server share it. */
export const CHAT_MODES = ["chat", "plan", "ask", "agent"] as const;
export type ChatMode = (typeof CHAT_MODES)[number];

export function isChatMode(value: unknown): value is ChatMode {
  return typeof value === "string" && (CHAT_MODES as readonly string[]).includes(value);
}

/** The mode stored for one conversation (`vas:mode:<id>`); anything unknown reads as Chat. */
export function storedChatMode(raw: string | null | undefined): ChatMode {
  return isChatMode(raw) ? raw : "chat";
}

/** What each mode offers. Mutating tools and MCP tools are the ones that need Ask or Agent. */
export const MODE_POLICY: Record<
  ChatMode,
  {
    /** Mutating tools (artifacts, todos, memory) and MCP tools are offered. */
    mutating: boolean;
    /** The model ends with `presentPlan`. */
    planCard: boolean;
    /** Each mutating or MCP call waits for an Allow / Deny card unless the chat allowed it. */
    approval: boolean;
    /** Access for CLI models. Ask asks Claude Code per change; other CLIs have no bridge and stay read-only. */
    cli: "chat" | "plan" | "ask" | "agent";
  }
> = {
  chat: { mutating: false, planCard: false, approval: false, cli: "chat" },
  plan: { mutating: false, planCard: true, approval: false, cli: "plan" },
  ask: { mutating: true, planCard: false, approval: true, cli: "ask" },
  agent: { mutating: true, planCard: false, approval: false, cli: "agent" },
};

/** Ask needs approval signatures, which only a secret can make. Without one it runs as Chat. */
export function effectiveToolMode(mode: ChatMode, hasApprovalSecret: boolean): ChatMode {
  return mode === "ask" && !hasApprovalSecret ? "chat" : mode;
}

/** The two-segment switch: "ask" (read-only) is the stored "chat"; "agent" covers stored "ask" and "agent". */
export type ModeSegment = "ask" | "agent";

/** Segment that lights up for a stored mode; Plan lights neither. */
export function modeSegment(mode: ChatMode): ModeSegment | null {
  return mode === "chat" ? "ask" : mode === "plan" ? null : "agent";
}

/** Stored mode a segment click selects. Agent keeps "ask" (confirm each change) when it is already on. */
export function segmentToMode(segment: ModeSegment, current: ChatMode): ChatMode {
  return segment === "ask" ? "chat" : current === "ask" ? "ask" : "agent";
}

/** Plain label for badges: stored "chat" reads Ask, "plan" Plan, "ask" and "agent" Agent. */
export function modeLabel(mode: string | null | undefined): "Ask" | "Agent" | "Plan" {
  return mode === "plan" ? "Plan" : mode === "ask" || mode === "agent" ? "Agent" : "Ask";
}

/** "Confirm each change" toggle: Agent <-> stored "ask". From any other mode it turns confirming on. */
export function toggleConfirm(mode: ChatMode): ChatMode {
  return mode === "ask" ? "agent" : "ask";
}

/** "Plan first" toggle: on selects Plan, off returns to read-only Ask. */
export function togglePlan(mode: ChatMode): ChatMode {
  return mode === "plan" ? "chat" : "plan";
}

/** True when this call must wait for the user. Callers apply it to mutating and MCP tools only. */
export function needsApproval(mode: ChatMode, toolId: string, allowed: ReadonlySet<string>): boolean {
  return MODE_POLICY[mode].approval && !allowed.has(toolId);
}

/**
 * Tools whose approval is answered in these messages. The SDK re-checks each answer against this request's
 * tools and denies it when the tool no longer needs approval, so "Allow for this chat" must not clear the
 * tool for the request that carries the answer.
 */
export function toolsWithAnsweredApproval(messages: ReadonlyArray<{ parts?: unknown }>): string[] {
  return messages.flatMap((m) =>
    (Array.isArray(m?.parts) ? (m.parts as Array<{ type?: unknown; state?: unknown }>) : [])
      .filter((p) => p?.state === "approval-responded" && typeof p.type === "string")
      .map((p) => (p.type as string).replace(/^tool-/, "")),
  );
}
