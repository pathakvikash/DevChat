import { describe, it, expect } from "vitest";
import { effectiveToolMode, isChatMode, MODE_POLICY, modeLabel, modeSegment, needsApproval, segmentToMode, storedChatMode, toggleConfirm, togglePlan, toolsWithAnsweredApproval } from "@/lib/chat/modes";

describe("effective tool mode", () => {
  it("runs Ask as Chat when no approval secret can sign the requests", () => {
    expect(effectiveToolMode("ask", false)).toBe("chat");
    expect(effectiveToolMode("ask", true)).toBe("ask");
    expect(effectiveToolMode("agent", false)).toBe("agent");
    expect(effectiveToolMode("plan", false)).toBe("plan");
  });
});

describe("chat modes storage", () => {
  it("accepts the four modes and nothing else", () => {
    for (const m of ["chat", "plan", "ask", "agent"]) expect(isChatMode(m)).toBe(true);
    for (const m of ["", "Agent", "auto", undefined, null, 1]) expect(isChatMode(m)).toBe(false);
  });

  it("reads a stored mode back per conversation, falling back to chat", () => {
    expect(storedChatMode("plan")).toBe("plan");
    expect(storedChatMode("ask")).toBe("ask");
    expect(storedChatMode("agent")).toBe("agent");
    expect(storedChatMode(null)).toBe("chat");
    expect(storedChatMode("old-value")).toBe("chat");
  });
});

describe("mode -> tool set", () => {
  it("chat and plan never offer mutating tools; ask and agent do", () => {
    expect(MODE_POLICY.chat.mutating).toBe(false);
    expect(MODE_POLICY.plan.mutating).toBe(false);
    expect(MODE_POLICY.ask.mutating).toBe(true);
    expect(MODE_POLICY.agent.mutating).toBe(true);
  });

  it("only plan ends with a plan card", () => {
    expect(["chat", "ask", "agent"].map((m) => MODE_POLICY[m as "chat"].planCard)).toEqual([false, false, false]);
    expect(MODE_POLICY.plan.planCard).toBe(true);
  });

  it("only ask asks before each call", () => {
    expect(MODE_POLICY.ask.approval).toBe(true);
    expect(MODE_POLICY.chat.approval || MODE_POLICY.plan.approval || MODE_POLICY.agent.approval).toBe(false);
  });

  it("maps CLI access: plan is plan, ask asks per change, agent may edit", () => {
    expect(MODE_POLICY.chat.cli).toBe("chat");
    expect(MODE_POLICY.plan.cli).toBe("plan");
    expect(MODE_POLICY.ask.cli).toBe("ask");
    expect(MODE_POLICY.agent.cli).toBe("agent");
  });

  it("needs approval in ask unless the chat allowed that tool", () => {
    const allowed = new Set(["createArtifact"]);
    expect(needsApproval("ask", "createArtifact", allowed)).toBe(false);
    expect(needsApproval("ask", "createTodo", allowed)).toBe(true);
    expect(needsApproval("agent", "createTodo", allowed)).toBe(false);
    expect(needsApproval("plan", "createTodo", allowed)).toBe(false);
  });
});

describe("Ask | Agent switch", () => {
  it("labels stored modes: chat is Ask, plan is Plan, ask and agent are Agent", () => {
    expect(["chat", "plan", "ask", "agent"].map(modeLabel)).toEqual(["Ask", "Plan", "Agent", "Agent"]);
    expect(modeLabel(undefined)).toBe("Ask");
  });

  it("lights Ask for chat, Agent for ask and agent, neither for plan", () => {
    expect((["chat", "plan", "ask", "agent"] as const).map(modeSegment)).toEqual(["ask", null, "agent", "agent"]);
  });

  it("segment clicks keep the stored values: Ask stays read-only, Agent keeps confirm on", () => {
    expect(segmentToMode("ask", "agent")).toBe("chat");
    expect(segmentToMode("agent", "chat")).toBe("agent");
    expect(segmentToMode("agent", "plan")).toBe("agent");
    expect(segmentToMode("agent", "ask")).toBe("ask");
  });

  it("Confirm each change flips agent and ask; Plan first flips plan and chat", () => {
    expect(toggleConfirm("agent")).toBe("ask");
    expect(toggleConfirm("ask")).toBe("agent");
    expect(toggleConfirm("chat")).toBe("ask");
    expect(togglePlan("chat")).toBe("plan");
    expect(togglePlan("plan")).toBe("chat");
  });
});

describe("answered approvals", () => {
  it("names the tools answered in these messages, and only those", () => {
    const messages = [
      { parts: [{ type: "tool-createArtifact", state: "output-available" }] },
      { parts: [{ type: "step-start" }, { type: "tool-createArtifact", state: "approval-responded" }] },
      { parts: [{ type: "tool-createTodo", state: "approval-requested" }] },
    ];
    expect(toolsWithAnsweredApproval(messages)).toEqual(["createArtifact"]);
    expect(toolsWithAnsweredApproval([{ parts: undefined }, {}])).toEqual([]);
  });
});
