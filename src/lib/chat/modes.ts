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
    /** Access for CLI models. Ask has no approval bridge yet, so CLI models stay read-only. */
    cli: "chat" | "plan" | "agent";
  }
> = {
  chat: { mutating: false, planCard: false, approval: false, cli: "chat" },
  plan: { mutating: false, planCard: true, approval: false, cli: "plan" },
  ask: { mutating: true, planCard: false, approval: true, cli: "chat" },
  agent: { mutating: true, planCard: false, approval: false, cli: "agent" },
};

/** Ask needs approval signatures, which only a secret can make. Without one it runs as Chat. */
export function effectiveToolMode(mode: ChatMode, hasApprovalSecret: boolean): ChatMode {
  return mode === "ask" && !hasApprovalSecret ? "chat" : mode;
}

/** True when this call must wait for the user. Callers apply it to mutating and MCP tools only. */
export function needsApproval(mode: ChatMode, toolId: string, allowed: ReadonlySet<string>): boolean {
  return MODE_POLICY[mode].approval && !allowed.has(toolId);
}
