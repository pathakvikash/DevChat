import { describe, it, expect } from "vitest";
import { shouldAutoContinue } from "@/lib/utils/messageParts";

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
