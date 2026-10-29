import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { ModelCatalogEntry, ModelConfig } from "@/lib/models";
import { isSanityMode } from "@/lib/sanityMode";

type CallOptions = Parameters<MockLanguageModelV3["doStream"]>[0];
type StreamPart = Awaited<ReturnType<MockLanguageModelV3["doStream"]>>["stream"] extends ReadableStream<infer P> ? P : never;

interface Turn {
  chunks?: string[];
  tool?: { name: string; input: object };
  /** Unique per turn, so a second approval card in the same chat has its own call id. */
  toolCallId?: string;
  delayMs?: number;
}

const usage = (n: number) => ({
  inputTokens: { total: n, noCache: n, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: n, text: n, reasoning: undefined },
});

const words = (s: string) => s.match(/\S+\s*/g) ?? [s];

function lastUserText({ prompt }: CallOptions): string {
  const user = [...prompt].reverse().find((m) => m.role === "user");
  if (!user || typeof user.content === "string") return "";
  return user.content.map((p) => (p.type === "text" ? p.text : "")).join("");
}

// Text of a prompt message, whatever its content shape.
const textOf = (m: { content: unknown }): string =>
  typeof m.content === "string"
    ? m.content
    : Array.isArray(m.content)
      ? m.content.map((p: { type?: string; text?: string }) => (p.type === "text" ? (p.text ?? "") : "")).join("")
      : "";

// True once a tool result follows the latest user message of this turn. A queued message reaches the
// model as a user message too; the queue specs prefix theirs with "queued:" so it does not start a turn.
function toolRanThisTurn({ prompt }: CallOptions): boolean {
  const turnStart = prompt.reduce(
    (at, m, i) => (m.role === "user" && !textOf(m).startsWith("queued:") ? i : at),
    -1,
  );
  return prompt.slice(turnStart + 1).some((m) => m.role === "tool");
}

// A sub-agent run starts with the helper prompt (see runSubAgent), not with the parent's.
const isHelper = ({ prompt }: CallOptions): boolean =>
  prompt.some((m) => m.role === "system" && textOf(m).startsWith("You are a helper"));

// Replies stay over 30 chars: the chat route forces a retry on shorter answers.
const echo = (o: CallOptions): Turn => ({
  chunks: words(`Mock reply (deterministic). You said: ${lastUserText(o)}`),
  delayMs: 15,
});

const MODELS: Record<string, { name: string; tools: boolean; turn: (o: CallOptions) => Turn }> = {
  "mock/echo": { name: "Mock Echo", tools: true, turn: echo },
  "mock/slow": {
    name: "Mock Slow",
    tools: true,
    turn: () => ({
      chunks: ["Slow mock reply: ", ...Array.from({ length: 60 }, (_, i) => `slow-${i + 1} `)],
      delayMs: 120,
    }),
  },
  "mock/tool": {
    name: "Mock Tool",
    tools: true,
    turn: (o) =>
      toolRanThisTurn(o)
        ? { chunks: words("The calculator returned 42, so 6 * 7 = 42. (mock tool answer)"), delayMs: 15 }
        // Slow enough (about 1.2 s before the answer) to queue a message during the tool step.
        : { tool: { name: "calculator", input: { expression: "6 * 7" } }, delayMs: 600 },
  },
  // Asks for a mutating tool, so Ask mode shows an approval card; Agent runs it without asking.
  "mock/write": {
    name: "Mock Write",
    tools: true,
    turn: (o) =>
      toolRanThisTurn(o)
        ? { chunks: words("Mock write reply (deterministic). The note step is finished."), delayMs: 15 }
        : {
            tool: { name: "createArtifact", input: { type: "document", title: "Mock note", content: "A note from the mock model." } },
            toolCallId: `mock-write-${o.prompt.length}`,
          },
  },
  // Ends a Plan-mode turn with presentPlan; after the answer (or the approve message) it replies in text.
  "mock/plan": {
    name: "Mock Plan",
    tools: true,
    turn: (o) =>
      toolRanThisTurn(o) || lastUserText(o).startsWith("Approved")
        ? { chunks: words("Mock plan reply (deterministic). The plan answer was received."), delayMs: 15 }
        : {
            tool: {
              name: "presentPlan",
              input: { title: "Add a cache", steps: ["Read the fetch path", "Add an in-memory cache", "Test the hit rate"] },
            },
            toolCallId: `mock-plan-${o.prompt.length}`,
          },
  },
  // Starts one helper with runAgent. The helper (its system prompt says so) writes a report, then the parent answers.
  "mock/subagent": {
    name: "Mock Sub-agent",
    tools: true,
    turn: (o) => {
      if (isHelper(o)) return { chunks: words("Mock helper report (deterministic). The folder has one note."), delayMs: 15 };
      return toolRanThisTurn(o)
        ? { chunks: words("Mock sub-agent answer (deterministic). The helper's report came back."), delayMs: 15 }
        : {
            tool: { name: "runAgent", input: { task: "Read the notes and summarise them.", title: "Note reader" } },
            toolCallId: `mock-agent-${o.prompt.length}`,
          };
    },
  },
  "mock/notools": {
    name: "Mock No Tools",
    tools: false,
    turn: (o) => ({ chunks: words(`Mock reply without tools. You said: ${lastUserText(o)}`), delayMs: 15 }),
  },
  "mock/summary": {
    name: "Mock Summary",
    tools: false,
    turn: () => ({
      chunks: ["### Goal\nMock summary of the conversation.\n\n### Key facts\n- Deterministic summary from mock/summary.\n"],
    }),
  },
};

function build(id: string): MockLanguageModelV3 {
  const { turn } = MODELS[id];
  return new MockLanguageModelV3({
    provider: "mock",
    modelId: id,
    doStream: async (options) => {
      const t = turn(options);
      const parts: StreamPart[] = [{ type: "stream-start", warnings: [] }];
      if (t.tool) {
        parts.push({ type: "tool-call", toolCallId: t.toolCallId ?? "mock-call-1", toolName: t.tool.name, input: JSON.stringify(t.tool.input) });
      } else {
        parts.push({ type: "text-start", id: "t1" });
        for (const delta of t.chunks ?? []) parts.push({ type: "text-delta", id: "t1", delta });
        parts.push({ type: "text-end", id: "t1" });
      }
      parts.push({ type: "finish", usage: usage(10), finishReason: { unified: t.tool ? "tool-calls" : "stop", raw: undefined } });
      return { stream: simulateReadableStream({ chunks: parts, initialDelayInMs: null, chunkDelayInMs: t.delayMs ?? null }) };
    },
    doGenerate: async (options) => {
      const t = turn(options);
      return {
        content: t.tool
          ? [{ type: "tool-call", toolCallId: t.toolCallId ?? "mock-call-1", toolName: t.tool.name, input: JSON.stringify(t.tool.input) }]
          : [{ type: "text", text: (t.chunks ?? []).join("") }],
        finishReason: { unified: t.tool ? "tool-calls" : "stop", raw: undefined },
        usage: usage(10),
        warnings: [],
      };
    },
  });
}

const entry = (id: string): ModelCatalogEntry => ({
  id,
  name: MODELS[id].name,
  provider: "Mock",
  contextWindow: 8192,
  supportsTools: MODELS[id].tools,
  supportsVision: false,
  supportsThinking: false,
});

export function mockModelCatalog(): ModelCatalogEntry[] {
  return isSanityMode() ? Object.keys(MODELS).map(entry) : [];
}

export function mockModelConfig(id: string): ModelConfig | undefined {
  if (!isSanityMode() || !Object.hasOwn(MODELS, id)) return undefined;
  return { ...entry(id), model: build(id), costPer1kInputTokens: 0, costPer1kOutputTokens: 0, maxTokens: 4096, supportsTools: MODELS[id].tools };
}
