import { describe, it, expect } from "vitest";
import { convertToModelMessages } from "ai";
import {
  normalizeToolParts,
  normalizeMessageToolParts,
} from "@/lib/chat/normalizeToolParts";

/** Count tool calls vs tool results across converted model messages. Any
 *  imbalance is what OpenAI-compatible providers reject. */
async function pairing(messages: any[]) {
  const model = await convertToModelMessages(messages as any);
  let calls = 0;
  let results = 0;
  for (const m of model) {
    if (!Array.isArray(m.content)) continue;
    for (const c of m.content as any[]) {
      if (c.type === "tool-call") calls++;
      if (c.type === "tool-result") results++;
    }
  }
  return { calls, results };
}

describe("normalizeToolParts", () => {
  it("merges a legacy split call/result pair into one resolved part", () => {
    const parts = normalizeToolParts([
      {
        type: "tool-webSearch",
        toolCallId: "c1",
        toolName: "webSearch",
        input: { query: "hi" },
        state: "output-available", // legacy: claimed output, had none
      },
      {
        type: "tool-webSearch",
        toolCallId: "c1",
        toolName: "webSearch",
        output: "results here",
        state: "result", // legacy pre-v6 state
      },
    ]) as any[];

    expect(parts).toHaveLength(1);
    expect(parts[0].state).toBe("output-available");
    expect(parts[0].output).toBe("results here");
    expect(parts[0].input).toEqual({ query: "hi" });
  });

  it("marks an unresolved call as errored instead of claiming an output", () => {
    const parts = normalizeToolParts([
      {
        type: "tool-executeCode",
        toolCallId: "c2",
        toolName: "executeCode",
        input: { code: "1+1" },
        state: "output-available",
      },
    ]) as any[];

    expect(parts).toHaveLength(1);
    expect(parts[0].state).toBe("output-error");
    expect(parts[0].errorText).toBeTruthy();
  });

  it("leaves non-tool parts untouched and in order", () => {
    const parts = normalizeToolParts([
      { type: "text", text: "a" },
      { type: "tool-x", toolCallId: "c3", toolName: "x", output: "o" },
      { type: "text", text: "b" },
    ]) as any[];
    expect(parts.map((p) => p.type)).toEqual(["text", "tool-x", "text"]);
  });

  it("passes through a non-array unchanged", () => {
    expect(normalizeToolParts(undefined)).toBeUndefined();
  });
});

describe("normalizeMessageToolParts + convertToModelMessages", () => {
  // What a reloaded conversation actually looked like: an executeCode call with
  // no result, plus a legacy split webSearch call/result pair.
  const brokenHistory = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "first question" }] },
    {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-webSearch",
          toolCallId: "w1",
          toolName: "webSearch",
          input: { query: "q" },
          state: "output-available",
        },
        {
          type: "tool-webSearch",
          toolCallId: "w1",
          toolName: "webSearch",
          output: "some results",
          state: "result",
        },
        {
          type: "tool-executeCode",
          toolCallId: "e1",
          toolName: "executeCode",
          input: { code: "1+1" },
          state: "output-available",
        },
      ],
    },
    { id: "u2", role: "user", parts: [{ type: "text", text: "second question" }] },
  ];

  it("leaves tool calls unanswered without normalization", async () => {
    const { calls, results } = await pairing(brokenHistory);
    expect(calls).toBeGreaterThan(results);
  });

  it("answers every tool call after normalization", async () => {
    const { calls, results } = await pairing(normalizeMessageToolParts(brokenHistory));
    expect(calls).toBe(results);
  });

  it("preserves both user turns so history survives", async () => {
    const model = await convertToModelMessages(
      normalizeMessageToolParts(brokenHistory) as any,
    );
    const userText = model
      .filter((m) => m.role === "user")
      .map((m) =>
        Array.isArray(m.content)
          ? (m.content as any[]).map((c) => c.text ?? "").join("")
          : String(m.content),
      );
    expect(userText).toEqual(["first question", "second question"]);
  });
});
