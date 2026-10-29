import { describe, it, expect } from "vitest";
import { ignoredTextStep, nextStepSettings } from "@/lib/chat/loopGuard";

const call = (toolName: string, input: object = {}) => ({ text: "", toolCalls: [{ toolName, input }] });
const words = { text: "a real sentence that is longer than twenty characters", toolCalls: [] };

describe("nextStepSettings", () => {
  it("forces a text-only step when the last two steps repeated the same call", () => {
    const steps = [call("runAgent", { task: "x" }), call("runAgent", { task: "x" })];
    expect(nextStepSettings({ steps, stepNumber: 2, maxSteps: 15 })).toEqual({ toolChoice: "none" });
  });

  it("leaves a call alone when its arguments differ", () => {
    const steps = [call("runAgent", { task: "x" }), call("runAgent", { task: "y" })];
    expect(nextStepSettings({ steps, stepNumber: 2, maxSteps: 15 })).toBeUndefined();
  });

  it("forces text after toolOnlyLimit tool-only steps in a row", () => {
    const steps = [call("webSearch", { q: 1 }), call("readFile", { p: 1 }), call("runAgent", { task: 2 })];
    expect(nextStepSettings({ steps, stepNumber: 3, maxSteps: 15, toolOnlyLimit: 3 })).toEqual({ toolChoice: "none" });
  });

  it("does not apply the tool-only limit when none is given", () => {
    const steps = [call("webSearch", { q: 1 }), call("readFile", { p: 1 }), call("runAgent", { task: 2 })];
    expect(nextStepSettings({ steps, stepNumber: 3, maxSteps: 15 })).toBeUndefined();
  });

  it("does not count a step that wrote text as tool-only", () => {
    const steps = [call("webSearch", { q: 1 }), words, call("runAgent", { task: 2 })];
    expect(nextStepSettings({ steps, stepNumber: 3, maxSteps: 15, toolOnlyLimit: 3 })).toBeUndefined();
  });

  it("forces text on the last allowed step", () => {
    expect(nextStepSettings({ steps: [words], stepNumber: 14, maxSteps: 15 })).toEqual({ toolChoice: "none" });
  });

  it("leaves an ordinary step alone", () => {
    expect(nextStepSettings({ steps: [], stepNumber: 0, maxSteps: 15, toolOnlyLimit: 3 })).toBeUndefined();
  });
});

describe("a retry after an error", () => {
  const callWithId = (id: string, toolName: string, input: object, content: Array<{ type: string; toolCallId?: string }> = []) => ({
    text: "",
    toolCalls: [{ toolCallId: id, toolName, input }],
    content: [{ type: "tool-call", toolCallId: id }, ...content],
  });

  it("does not force text when the earlier identical call threw", () => {
    const failed = callWithId("c1", "readFile", { p: "a.md" }, [{ type: "tool-error", toolCallId: "c1" }]);
    const retry = callWithId("c2", "readFile", { p: "a.md" });
    expect(nextStepSettings({ steps: [failed, retry], stepNumber: 2, maxSteps: 15 })).toBeUndefined();
  });

  it("still forces text when the earlier identical call succeeded", () => {
    const ok = callWithId("c1", "readFile", { p: "a.md" });
    const again = callWithId("c2", "readFile", { p: "a.md" });
    expect(nextStepSettings({ steps: [ok, again], stepNumber: 2, maxSteps: 15 })).toEqual({ toolChoice: "none" });
  });
});

describe("ignoredTextStep (fallback for providers that ignore toolChoice none)", () => {
  it("does not stop after three tool-only steps, because the forced text step has not run yet", () => {
    const steps = [call("a"), call("b"), call("c")];
    expect(ignoredTextStep(steps, 3)).toBe(false);
  });

  it("stops when the forced step was tool-only too", () => {
    const steps = [call("a"), call("b"), call("c"), call("d")];
    expect(ignoredTextStep(steps, 3)).toBe(true);
  });

  it("does not stop when the forced step wrote its answer", () => {
    const steps = [call("a"), call("b"), call("c"), words];
    expect(ignoredTextStep(steps, 3)).toBe(false);
  });
});
