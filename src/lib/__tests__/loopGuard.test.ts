import { describe, it, expect } from "vitest";
import { nextStepSettings } from "@/lib/chat/loopGuard";

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
