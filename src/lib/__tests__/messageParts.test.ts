import { describe, it, expect } from "vitest";
import {
  shouldAutoContinue,
  settleStaleParts,
  NOT_ANSWERED,
  waitingPlanCallId,
  denyOpenApprovals,
  approvalTitle,
  STOPPED_REPLY,
} from "@/lib/utils/messageParts";

/** `executeCode` runs in the browser, so its reply needs a second request to continue.
 *  The tool part is not necessarily last — reasoning parts can follow it. */
describe("shouldAutoContinue", () => {
  const call = (state = "output-available") => ({
    type: "tool-executeCode",
    toolCallId: "c1",
    state,
  });

  it("continues when the finished executeCode call is the last part", () => {
    expect(shouldAutoContinue([{ type: "text", text: "running it" }, call()])).toBe(true);
  });

  it("continues when a trailing reasoning or step-start part follows the call", () => {
    expect(shouldAutoContinue([call(), { type: "reasoning", text: "thought for 400 tokens" }])).toBe(true);
    expect(shouldAutoContinue([call("result"), { type: "step-start" }])).toBe(true);
  });

  it("does not continue when the model already answered after the result", () => {
    expect(shouldAutoContinue([call(), { type: "text", text: "Here is the table." }])).toBe(false);
  });

  it("does not continue while the call is still waiting for its output", () => {
    expect(shouldAutoContinue([call("input-available")])).toBe(false);
  });

  it("does not continue for askClarification, which the user answers", () => {
    expect(
      shouldAutoContinue([{ type: "tool-askClarification", toolCallId: "c2", state: "output-available" }]),
    ).toBe(false);
  });

  it("does not continue for a reply with no tool calls", () => {
    expect(shouldAutoContinue([{ type: "text", text: "hello" }])).toBe(false);
    expect(shouldAutoContinue([])).toBe(false);
    expect(shouldAutoContinue(undefined)).toBe(false);
  });
});

describe("plan decisions", () => {
  it("finds the plan card still waiting in the latest message", () => {
    const messages = [
      { role: "user", parts: [{ type: "text", text: "plan it" }] },
      { role: "assistant", parts: [{ type: "tool-presentPlan", toolCallId: "p1", state: "input-available", input: {} }] },
    ];
    expect(waitingPlanCallId(messages)).toBe("p1");
  });

  it("finds nothing once the card is answered or a newer message follows it", () => {
    const answered = [{ role: "assistant", parts: [{ type: "tool-presentPlan", toolCallId: "p1", state: "output-available", output: {} }] }];
    const stale = [
      { role: "assistant", parts: [{ type: "tool-presentPlan", toolCallId: "p1", state: "input-available", input: {} }] },
      { role: "user", parts: [{ type: "text", text: "hi" }] },
    ];
    expect(waitingPlanCallId(answered)).toBeUndefined();
    expect(waitingPlanCallId(stale)).toBeUndefined();
  });
});

describe("presentPlan and stale cards", () => {
  it("resumes a revised plan card, but not an approved one (approve sends its own message) or a waiting one", () => {
    const answered = (output: unknown) => [{ type: "tool-presentPlan", state: "output-available", output }];
    expect(shouldAutoContinue(answered({ action: "revise", feedback: "shorter" }))).toBe(true);
    expect(shouldAutoContinue(answered({ action: "approve", mode: "agent" }))).toBe(false);
    expect(shouldAutoContinue([{ type: "tool-presentPlan", state: "input-available", input: {} }])).toBe(false);
  });

  it("never resumes while any approval card in the last message still waits", () => {
    const waiting = { type: "tool-createArtifact", state: "approval-requested", approval: { id: "a1" } };
    const done = { type: "tool-executeCode", state: "output-available", output: "ok" };
    expect(shouldAutoContinue([done, waiting])).toBe(false);
    expect(shouldAutoContinue([waiting, done])).toBe(false);
  });

  it("denies every waiting card of a stopped reply and leaves the rest alone", () => {
    const text = { type: "text", text: "hi" };
    const [card, other] = denyOpenApprovals([
      { type: "tool-createArtifact", state: "approval-requested", approval: { id: "a1" } },
      text,
    ]);
    expect(card).toEqual({ type: "tool-createArtifact", state: "output-denied", approval: { id: "a1", approved: false, reason: STOPPED_REPLY } });
    expect(other).toBe(text);
  });

  it("titles a card by its tool", () => {
    expect(approvalTitle("createArtifact", { title: "Notes" })).toBe('Create artifact "Notes"');
    expect(approvalTitle("mcp_docs_search", {})).toBe("Run search on an MCP server");
  });

  it("settles an unanswered approval in an older message as not answered", () => {
    const [part] = settleStaleParts([{ type: "tool-createArtifact", state: "approval-requested", approval: { id: "a1" } }], false);
    expect(part).toEqual({ type: "tool-createArtifact", state: "output-denied", approval: { id: "a1", approved: false, reason: NOT_ANSWERED } });
  });

  it("leaves the latest message's cards alone", () => {
    const parts = [{ type: "tool-createArtifact", state: "approval-requested", approval: { id: "a1" } }];
    expect(settleStaleParts(parts, true)).toBe(parts);
  });

  it("settles an unanswered plan card that a newer message replaced", () => {
    const [part] = settleStaleParts<any>([{ type: "tool-presentPlan", state: "input-available", input: { title: "x" } }], false);
    expect(part.state).toBe("output-denied");
    expect(part.approval.reason).toBe("Replaced by a newer plan");
  });
});

describe("shouldAutoContinue for sendToChat", () => {
  const send = (state: string, extra: Record<string, unknown> = {}) => ({
    type: "tool-sendToChat",
    toolCallId: "c1",
    state,
    input: { to: "side", message: "hi" },
    ...extra,
  });

  it("continues once the browser has answered the send", () => {
    expect(shouldAutoContinue([send("output-available", { output: "Delivered." })] as any)).toBe(true);
  });

  it("waits while the send is still pending", () => {
    expect(shouldAutoContinue([send("input-available")] as any)).toBe(false);
  });
});
