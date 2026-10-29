import { describe, it, expect } from "vitest";
import type { AgentPane } from "@/lib/chat/agentMessages";
import { AGENT_NOT_OPEN, raiseHop, routeAgentMessage } from "@/lib/utils/agentLink";

const panes: AgentPane[] = [
  { id: "main", title: "Pricing research", kind: "chat" },
  { id: "other", title: "Notes", kind: "chat" },
  { id: "side1", title: "", kind: "side" },
  { id: "sub", title: "Note reader", kind: "subagent" },
];
const parentOf = { side1: "main" };

describe("raiseHop", () => {
  it("keeps the larger hop, so a turn started by a message takes the bigger count", () => {
    expect(raiseHop(0, 2)).toBe(2);
    expect(raiseHop(3, 1)).toBe(3);
  });
});

describe("routeAgentMessage", () => {
  it("routes to another open chat by id or exact title, ignoring case", () => {
    expect(routeAgentMessage("other", "main", panes, parentOf)).toEqual({ id: "other" });
    expect(routeAgentMessage("notes", "main", panes, parentOf)).toEqual({ id: "other" });
  });

  it("routes \"side\" to the sender's own open side chat", () => {
    expect(routeAgentMessage("side", "main", panes, parentOf)).toEqual({ id: "side1" });
  });

  it("asks for the side chat to open when the main chat has none", () => {
    expect(routeAgentMessage("side", "other", panes, parentOf)).toEqual({ openSideOf: "other" });
  });

  it("refuses \"side\" from a side chat", () => {
    expect(routeAgentMessage("side", "side1", panes, parentOf)).toEqual({ error: AGENT_NOT_OPEN });
  });

  it("refuses the sender itself, a closed chat and a sub-agent transcript", () => {
    expect(routeAgentMessage("Pricing research", "main", panes, parentOf)).toEqual({ error: AGENT_NOT_OPEN });
    expect(routeAgentMessage("closed", "main", panes, parentOf)).toEqual({ error: AGENT_NOT_OPEN });
    expect(routeAgentMessage("sub", "main", panes, parentOf)).toEqual({ error: AGENT_NOT_OPEN });
    expect(routeAgentMessage("Note reader", "main", panes, parentOf)).toEqual({ error: AGENT_NOT_OPEN });
  });
});
