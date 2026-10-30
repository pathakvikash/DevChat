import { describe, it, expect, vi, afterEach } from "vitest";
import { simulateReadableStream, tool, type Tool, type UIMessage } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { runSubAgent, REPORT_MAX_CHARS, type SubAgentProgress } from "@/lib/chat/subAgent";
import type { ModelConfig } from "@/lib/models";

type CallOptions = Parameters<MockLanguageModelV3["doStream"]>[0];
type Turn = { text?: string[]; tool?: { name: string; input: object }; hang?: boolean };

const usage = {
  inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

/** A mock model whose reply for each call comes from `turn`. Records every call it gets. */
function scriptedModel(turn: (o: CallOptions) => Turn, supportsTools = true) {
  const calls: CallOptions[] = [];
  const mock = new MockLanguageModelV3({
    provider: "mock",
    modelId: "mock/sub",
    doStream: async (options) => {
      calls.push(options);
      const t = turn(options);
      if (t.hang) {
        // Streams some text, then never closes: only an abort or the timeout ends it.
        const deltas = t.text ?? ["Working on it"];
        return {
          stream: new ReadableStream<any>({
            start(c) {
              c.enqueue({ type: "stream-start", warnings: [] });
              c.enqueue({ type: "text-start", id: "t1" });
              for (const delta of deltas) c.enqueue({ type: "text-delta", id: "t1", delta });
            },
          }),
        };
      }
      const parts: any[] = [{ type: "stream-start", warnings: [] }];
      if (t.tool) {
        parts.push({ type: "tool-call", toolCallId: `call-${calls.length}`, toolName: t.tool.name, input: JSON.stringify(t.tool.input) });
      } else {
        parts.push({ type: "text-start", id: "t1" });
        for (const delta of t.text ?? []) parts.push({ type: "text-delta", id: "t1", delta });
        parts.push({ type: "text-end", id: "t1" });
      }
      parts.push({ type: "finish", usage, finishReason: { unified: t.tool ? "tool-calls" : "stop", raw: undefined } });
      return { stream: simulateReadableStream({ chunks: parts, initialDelayInMs: null, chunkDelayInMs: null }) };
    },
  });
  const config: ModelConfig = {
    id: "mock/sub",
    name: "Mock Sub",
    provider: "Mock",
    model: mock,
    costPer1kInputTokens: 0,
    costPer1kOutputTokens: 0,
    maxTokens: 1000,
    contextWindow: 8192,
    supportsTools,
  };
  return { config, calls };
}

const hasToolResult = (o: CallOptions) => o.prompt.some((m) => m.role === "tool");
const toolNames = (o: CallOptions) => (o.tools ?? []).map((t: any) => t.name);

function calculator(execute = vi.fn(async ({ a }: { a: number }) => `sum ${a}`)): Tool {
  return tool({ description: "Add a number", inputSchema: z.object({ a: z.number() }), execute });
}

const brief = "Find where the cache is written and report the file path.";

afterEach(() => {
  vi.useRealTimers();
});

describe("runSubAgent", () => {
  it("returns a plain text report with one step and the brief in the transcript", async () => {
    const { config, calls } = scriptedModel(() => ({ text: ["The cache is written in ", "src/cache.ts."] }));
    const res = await runSubAgent({ brief, model: config, mode: "agent", tools: {}, abortSignal: new AbortController().signal });

    expect(res.status).toBe("done");
    expect(res.report).toBe("The cache is written in src/cache.ts.");
    expect(res.steps).toBe(1);
    expect(calls[0].tools).toBeUndefined();
    expect(res.transcript[0]).toMatchObject({ role: "user", parts: [{ type: "text", text: brief }] });
    expect(res.transcript[1].role).toBe("assistant");
    expect(res.transcript[1].parts).toContainEqual(expect.objectContaining({ type: "text", text: "The cache is written in src/cache.ts." }));
  });

  it("runs a tool call, then writes the report from its result", async () => {
    const execute = vi.fn(async ({ a }: { a: number }) => `sum ${a}`);
    const { config } = scriptedModel((o) =>
      hasToolResult(o) ? { text: ["The sum is 2."] } : { tool: { name: "calculator", input: { a: 2 } } },
    );
    const events: SubAgentProgress[] = [];
    const res = await runSubAgent({
      brief,
      model: config,
      mode: "agent",
      tools: { calculator: calculator(execute) },
      abortSignal: new AbortController().signal,
      onProgress: (e) => events.push(e),
    });

    expect(res.status).toBe("done");
    expect(res.report).toBe("The sum is 2.");
    expect(res.steps).toBe(2);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toEqual({ a: 2 });
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["step started", "tool call", "tool result", "text delta"]),
    );
    expect(events).toContainEqual({ type: "tool call", step: 1, tool: "calculator", label: '{"a":2}' });
    expect(events).toContainEqual({ type: "tool result", step: 1, tool: "calculator", ok: true });
    const toolPart = res.transcript[1].parts.find((p) => p.type === "tool-calculator") as any;
    expect(toolPart).toMatchObject({ state: "output-available", output: "sum 2" });
  });

  it("forces the 15th step to a written report", async () => {
    // Distinct arguments: identical repeats trip the loop guard before step 15.
    let n = 0;
    const { config, calls } = scriptedModel((o) =>
      o.toolChoice?.type === "none" ? { text: ["Final report."] } : { tool: { name: "calculator", input: { a: ++n } } },
    );
    const res = await runSubAgent({
      brief,
      model: config,
      mode: "agent",
      tools: { calculator: calculator() },
      abortSignal: new AbortController().signal,
    });

    expect(res.status).toBe("done");
    expect(res.steps).toBe(15);
    expect(res.report).toBe("Final report.");
    expect(calls).toHaveLength(15);
    expect(calls[14].toolChoice).toEqual({ type: "none" });
  });

  it("stops at 15 steps with a limit note when the model ignores the forced report", async () => {
    const { config, calls } = scriptedModel(() => ({ tool: { name: "calculator", input: { a: 1 } } }));
    const res = await runSubAgent({
      brief,
      model: config,
      mode: "agent",
      tools: { calculator: calculator() },
      abortSignal: new AbortController().signal,
    });

    expect(res.status).toBe("done");
    expect(res.steps).toBe(15);
    expect(calls).toHaveLength(15);
    expect(res.report).toContain("15-step limit");
  });

  it("returns timeout when the run outlasts timeoutMs", async () => {
    const { config } = scriptedModel(() => ({ hang: true }));
    const res = await runSubAgent({
      brief,
      model: config,
      mode: "agent",
      tools: {},
      abortSignal: new AbortController().signal,
      timeoutMs: 30,
    });

    expect(res.status).toBe("timeout");
    expect(res.transcript).toHaveLength(2);
  });

  it("returns stopped when the parent aborts mid-run", async () => {
    const { config } = scriptedModel(() => ({ hang: true }));
    const parent = new AbortController();
    const res = await runSubAgent({
      brief,
      model: config,
      mode: "agent",
      tools: {},
      abortSignal: parent.signal,
      onProgress: (e) => {
        if (e.type === "text delta") parent.abort();
      },
    });

    expect(res.status).toBe("stopped");
    expect(res.transcript[1].parts).toContainEqual(expect.objectContaining({ type: "text", text: "Working on it" }));
  });

  it("returns error with the message when the model fails", async () => {
    const mock = new MockLanguageModelV3({
      doStream: async () => {
        throw new Error("CLI not on PATH");
      },
    });
    const config = { ...scriptedModel(() => ({ text: [] })).config, model: mock };
    const res = await runSubAgent({ brief, model: config, mode: "agent", tools: {}, abortSignal: new AbortController().signal });

    expect(res.status).toBe("error");
    expect(res.error).toContain("CLI not on PATH");
  });

  it("caps the report at 8,000 characters", async () => {
    const { config } = scriptedModel(() => ({ text: ["x".repeat(20_000)] }));
    const res = await runSubAgent({ brief, model: config, mode: "agent", tools: {}, abortSignal: new AbortController().signal });

    expect(res.report.length).toBe(REPORT_MAX_CHARS);
    expect(res.report.endsWith("…cut…")).toBe(true);
  });

  it("strips runAgent and the browser-only tools before the model sees them", async () => {
    const { config, calls } = scriptedModel(() => ({ text: ["done"] }));
    const noop = calculator();
    const tools = {
      calculator: noop,
      runAgent: noop,
      messageAgent: noop,
      sendToChat: noop,
      presentPlan: noop,
      executeCode: noop,
      askClarification: noop,
      createTodo: noop,
      createTodos: noop,
      updateTodo: noop,
    };
    await runSubAgent({ brief, model: config, mode: "agent", tools, abortSignal: new AbortController().signal });

    expect(toolNames(calls[0])).toEqual(["calculator"]);
  });

  it("throttles text delta events", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000);
    const { config } = scriptedModel(() => ({ text: Array.from({ length: 50 }, (_, i) => `word${i} `) }));
    const events: SubAgentProgress[] = [];
    await runSubAgent({
      brief,
      model: config,
      mode: "agent",
      tools: {},
      abortSignal: new AbortController().signal,
      onProgress: (e) => events.push(e),
    });

    // The first delta goes out at once; the rest of the burst is coalesced into the one sent at the end.
    const deltas = events.filter((e) => e.type === "text delta");
    expect(deltas).toHaveLength(2);
    expect(deltas[1]).toMatchObject({ type: "text delta", preview: expect.stringMatching(/word49 $/) });
  });

  it("delivers the last event of a burst when the throttle window ends", async () => {
    const burst = Array.from({ length: 10 }, (_, i) => `w${i} `);
    const { config } = scriptedModel(() => ({ hang: true, text: burst }));
    const start = Date.now();
    const events: Array<SubAgentProgress & { at: number }> = [];
    const res = await runSubAgent({
      brief,
      model: config,
      mode: "agent",
      tools: {},
      abortSignal: new AbortController().signal,
      timeoutMs: 600,
      onProgress: (e) => events.push({ ...e, at: Date.now() - start }),
    });

    // The stream never ends, so the trailing event must come from the window timer (250 ms), not the final flush at the timeout.
    const deltas = events.filter((e) => e.type === "text delta");
    expect(res.status).toBe("timeout");
    expect(deltas).toHaveLength(2);
    expect(deltas[1]).toMatchObject({ preview: expect.stringMatching(/w9 $/) });
    expect(deltas[1].at).toBeLessThan(500);
  });

  it("runs a model without tools as one text step and sends it no tools", async () => {
    const { config, calls } = scriptedModel(() => ({ text: ["Plain answer."] }), false);
    const res = await runSubAgent({
      brief,
      model: config,
      mode: "chat",
      tools: { calculator: calculator() },
      abortSignal: new AbortController().signal,
    });

    expect(res.status).toBe("done");
    expect(res.report).toBe("Plain answer.");
    expect(res.steps).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].tools).toBeUndefined();
  });
});

describe("runSubAgent with resume", () => {
  it("sends the saved messages, then the new one framed as the parent's message", async () => {
    const { config, calls } = scriptedModel(() => ({ text: ["Done: two notes."] }), false);
    const history: UIMessage[] = [
      { id: "h1", role: "user", parts: [{ type: "text", text: "Read the notes." }] },
      { id: "h2", role: "assistant", parts: [{ type: "text", text: "One note." }] },
    ];
    const message = {
      id: "n1",
      role: "user",
      parts: [
        { type: "data-agent-message", data: { from: "parent", fromConversationId: "p1", fromTitle: "Main", hop: 1 } },
        { type: "text", text: "Check the second folder." },
      ],
    } as unknown as UIMessage;

    const res = await runSubAgent({
      brief: "Check the second folder.",
      model: config,
      mode: "agent",
      tools: {},
      abortSignal: new AbortController().signal,
      resume: { history, message },
    });

    expect(res.status).toBe("done");
    expect(res.report).toBe("Done: two notes.");
    expect(res.transcript[0].id).toBe("n1");
    const prompt = JSON.stringify(calls[0].prompt);
    expect(prompt).toContain("Read the notes.");
    expect(prompt).toContain("One note.");
    expect(prompt).toContain("Message from Main (the main chat, not the user):\\n```\\nCheck the second folder.\\n```");
  });
});
