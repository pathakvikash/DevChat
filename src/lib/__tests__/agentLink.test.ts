import { describe, it, expect } from "vitest";
import type { AgentPane } from "@/lib/chat/agentMessages";
import { AGENT_NOT_OPEN, exchangeEnded, raiseHop, routeAgentMessage } from "@/lib/utils/agentLink";
import { canDeliver, nextHop } from "@/lib/chat/agentMessages";

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

  it("a leftover agent message sent at its own hop still counts toward the cap", () => {
    // A queued message at hop 3 leaves its pane at 3, so the pane's next message is refused.
    expect(canDeliver(nextHop(raiseHop(0, 3)))).toBe(false);
    expect(canDeliver(nextHop(raiseHop(0, 2)))).toBe(true);
  });
});

describe("exchangeEnded", () => {
  const partners = new Map([["a", "b"], ["b", "a"]]);

  it("resets both panes of an exchange once the partner is idle", () => {
    expect(exchangeEnded("b", partners, () => false)).toEqual(["b", "a"]);
  });

  it("leaves the hops while the partner still replies", () => {
    expect(exchangeEnded("b", partners, (id) => id === "a")).toEqual([]);
  });

  it("finds the partner after a refusal at the cap, which clears the talk but not the partners", () => {
    // a -> b -> a -> b are hops 1..3; b's next message is refused. Both panes hold hop 3 until b's reply ends.
    const hops = new Map([["a", 3], ["b", 3]]);
    for (const id of exchangeEnded("b", partners, () => false)) hops.delete(id);
    expect(hops.size).toBe(0);
  });

  it("resets a pane with no partner, e.g. one that got a leftover agent message after a reload", () => {
    expect(exchangeEnded("c", partners, () => false)).toEqual(["c"]);
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
