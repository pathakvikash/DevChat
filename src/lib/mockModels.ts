import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { ModelCatalogEntry, ModelConfig } from "@/lib/models";
import { isSanityMode } from "@/lib/sanityMode";

type CallOptions = Parameters<MockLanguageModelV3["doStream"]>[0];
type StreamPart = Awaited<ReturnType<MockLanguageModelV3["doStream"]>>["stream"] extends ReadableStream<infer P> ? P : never;

interface Turn {
  chunks?: string[];
  tool?: { name: string; input: object };
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

// True once a tool result follows the latest user message.
function toolRanThisTurn({ prompt }: CallOptions): boolean {
  const lastUser = prompt.map((m) => m.role).lastIndexOf("user");
  return prompt.slice(lastUser + 1).some((m) => m.role === "tool");
}

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
        : { tool: { name: "calculator", input: { expression: "6 * 7" } } },
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
        parts.push({ type: "tool-call", toolCallId: "mock-call-1", toolName: t.tool.name, input: JSON.stringify(t.tool.input) });
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
          ? [{ type: "tool-call", toolCallId: "mock-call-1", toolName: t.tool.name, input: JSON.stringify(t.tool.input) }]
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
