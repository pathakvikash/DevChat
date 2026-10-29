import { describe, it, expect } from "vitest";
import { convertToModelMessages } from "ai";
import {
  AGENT_MESSAGE_PART,
  agentBadgeText,
  agentMessageModelText,
  buildAgentMessagePart,
  canDeliver,
  frameAgentMessageParts,
  nextHop,
  parseAgentMessagePart,
  resolveAgentTarget,
  sendToChatTargets,
  type AgentMessageData,
  type AgentPane,
} from "@/lib/chat/agentMessages";
import { normalizeMessageToolParts } from "@/lib/chat/normalizeToolParts";

const sender: AgentMessageData = {
  from: "chat",
  fromConversationId: "conv_pricing",
  fromTitle: "Pricing research",
  hop: 2,
};

describe("agent message part", () => {
  it("round-trips through build and parse", () => {
    const part = buildAgentMessagePart(sender);
    expect(part.type).toBe(AGENT_MESSAGE_PART);
    expect(parseAgentMessagePart(part)).toEqual(sender);
  });

  it("rejects parts that are not well formed", () => {
    expect(parseAgentMessagePart({ type: "text", text: "hi" })).toBeNull();
    expect(parseAgentMessagePart({ type: AGENT_MESSAGE_PART })).toBeNull();
    expect(parseAgentMessagePart({ type: AGENT_MESSAGE_PART, data: { ...sender, from: "user" } })).toBeNull();
    expect(parseAgentMessagePart({ type: AGENT_MESSAGE_PART, data: { ...sender, hop: 0 } })).toBeNull();
    expect(parseAgentMessagePart({ type: AGENT_MESSAGE_PART, data: { ...sender, hop: 1.5 } })).toBeNull();
  });
});

describe("hop cap", () => {
  it("counts from the pane's hop and allows three agent messages per user send", () => {
    // A user send resets the pane to 0; each agent message goes one hop further.
    const hops = [nextHop(0), nextHop(1), nextHop(2)];
    expect(hops).toEqual([1, 2, 3]);
    expect(hops.every(canDeliver)).toBe(true);
  });

  it("refuses the fourth agent message", () => {
    expect(canDeliver(nextHop(3))).toBe(false);
    expect(canDeliver(0)).toBe(false);
  });
});

describe("target list", () => {
  const panes: AgentPane[] = [
    { id: "main", title: "Pricing research", kind: "chat" },
    { id: "me", title: "Plan", kind: "chat" },
    { id: "side", title: "", kind: "side" },
    { id: "helper", title: "Helper run", kind: "subagent" },
  ];

  it("lists other open chats, never itself or a sub-agent transcript", () => {
    expect(sendToChatTargets(panes, "me", true)).toEqual([
      { id: "main", title: "Pricing research" },
      { id: "side", title: "Side chat" },
    ]);
  });

  it("is empty when no other pane is open", () => {
    expect(sendToChatTargets([panes[1]], "me", true)).toEqual([]);
  });

  it("is empty for a model without tools", () => {
    expect(sendToChatTargets(panes, "me", false)).toEqual([]);
  });

  it("resolves by id, then by exact title ignoring case", () => {
    const targets = sendToChatTargets(panes, "me", true);
    expect(resolveAgentTarget("main", targets)).toEqual({ target: { id: "main", title: "Pricing research" } });
    expect(resolveAgentTarget("  pricing RESEARCH ", targets)).toEqual({
      target: { id: "main", title: "Pricing research" },
    });
  });

  it("refuses an unknown chat and an ambiguous title", () => {
    const targets = [
      { id: "a", title: "Notes" },
      { id: "b", title: "notes" },
    ];
    expect(resolveAgentTarget("gone", targets)).toEqual({ error: "That chat is not open." });
    expect(resolveAgentTarget("Notes", targets)).toHaveProperty("error");
    expect(resolveAgentTarget("a", targets)).toEqual({ target: { id: "a", title: "Notes" } });
  });
});

describe("model text framing", () => {
  it("says who sent it and that it is not the user", () => {
    const text = agentMessageModelText(sender, "What is the price?");
    expect(text).toBe(
      "Message from Pricing research (another chat, not the user; reply only through sendToChat): What is the price?",
    );
  });

  it("names the main chat for a sub-agent follow-up", () => {
    const text = agentMessageModelText({ ...sender, from: "parent", fromTitle: "" }, "Go deeper");
    expect(text).toContain("Message from the main chat's assistant (the main chat, not the user)");
  });

  it("badge reads From <title>, cut to the limit with an ellipsis", () => {
    expect(agentBadgeText(sender)).toBe('From "Pricing research"');
    expect(agentBadgeText(sender, 6)).toBe('From "Pricin…"');
    expect(agentBadgeText({ from: "side", fromTitle: "  " })).toBe("From side chat");
  });
});

describe("replay conversion", () => {
  it("turns the part into model text on the same message, for every provider path", async () => {
    const messages = normalizeMessageToolParts([
      {
        id: "u1",
        role: "user",
        parts: [buildAgentMessagePart(sender), { type: "text", text: "What is the price?" }],
      },
    ]);
    const model = await convertToModelMessages(messages as any);
    const json = JSON.stringify(model);
    expect(json).toContain("Message from Pricing research (another chat, not the user");
    expect(json).toContain("What is the price?");
    expect(json).not.toContain(AGENT_MESSAGE_PART);
  });

  it("keeps a part with no text after it as a header only", () => {
    expect(frameAgentMessageParts([buildAgentMessagePart(sender)])).toEqual([
      { type: "text", text: agentMessageModelText(sender, "") },
    ]);
  });

  it("leaves messages without agent parts untouched", () => {
    const parts = [{ type: "text", text: "plain" }];
    expect(frameAgentMessageParts(parts)).toBe(parts);
  });
});
