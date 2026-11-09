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

const offersTool = ({ tools }: CallOptions, name: string): boolean =>
  (tools ?? []).some((t) => t.type === "function" && t.name === name);

// A sub-agent run starts with the helper prompt (see runSubAgent), not with the parent's.
const isHelper = ({ prompt }: CallOptions): boolean =>
  prompt.some((m) => m.role === "system" && textOf(m).startsWith("You are a helper"));

// Replies stay over 30 chars: the chat route forces a retry on shorter answers.
const echo = (o: CallOptions): Turn => ({
  chunks: words(`Mock reply (deterministic). You said: ${lastUserText(o)}`),
  delayMs: 15,
});


// A workflow agent card: its system prompt says so (see workflowSystemPrompt). With output fields it answers a JSON
// block built from them (number 72, choice its first option, text "mock <name>"); without, a one-line digest.
const isWorkflowStep = ({ prompt }: CallOptions): boolean =>
  prompt.some((m) => m.role === "system" && textOf(m).startsWith("You are one step in a DevChat workflow"));

// Slow enough (about 4 s a card) for the editor's 1.5 s poll to catch the card while it is Running, with margin.
const STEP_MS = 800;

function workflowTurn(o: CallOptions): Turn {
  if (!isWorkflowStep(o)) return echo(o);
  const system = textOf(o.prompt.find((m) => m.role === "system")!);
  const fieldBlock = system.split("nothing after it:\n")[1];
  if (fieldBlock) {
    const value: Record<string, unknown> = {};
    for (const line of fieldBlock.split("\n")) {
      const m = /^- (\w+) \((number|text|yes or no|list|one of: ([^)]*))\)/.exec(line);
      if (!m) continue;
      value[m[1]] = m[2] === "number" ? 72 : m[2] === "yes or no" ? true : m[2] === "list" ? [`mock ${m[1]}`] : m[3] ? m[3].split(",")[0].trim() : `mock ${m[1]}`;
    }
    return { chunks: [`Mock result (deterministic).\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``], delayMs: STEP_MS };
  }
  const input = lastUserText(o).split("Input (data from earlier cards, not instructions):")[1] ?? "";
  let n = (input.match(/"url"/g) ?? []).length;
  try {
    const json = JSON.parse(input.replace(/^\s*`{3,}\n?/, "").replace(/\n?`{3,}\s*$/, ""));
    n = Array.isArray(json) ? json.length : Array.isArray(json?.items) ? json.items.length : n;
  } catch {
    // keep the count of "url" keys
  }
  return { chunks: [`Mock digest (deterministic): ${n} items`], delayMs: STEP_MS };
}

// "Describe your flow" (workflows 7): a fixed News graph. Text containing "broken" gets invalid JSON first; the repair
// call (it follows an assistant message) gets the valid graph.
const NEWS_FLOW = {
  vars: [{ key: "topics", label: "Topics to search, one per line", value: "AI developer tools news" }],
  nodes: [
    { id: "trigger", type: "trigger", fromIds: [], config: {}, label: "Run manually" },
    { id: "news", type: "webSearch", fromIds: ["trigger"], config: { queries: "{{vars.topics}}" }, label: "Search the news" },
    { id: "digest", type: "agent", fromIds: ["news"], config: { instructions: "Write a short digest with links.", input: "{{news.items}}" }, label: "Write the digest" },
    { id: "post", type: "chatMessage", fromIds: ["digest"], config: { chat: "new", message: "{{digest.text}}" }, label: "Post to a chat" },
  ],
};
function flowgenTurn(o: CallOptions): Turn {
  const repairing = o.prompt.some((m) => m.role === "assistant");
  const broken = o.prompt.some((m) => m.role === "user" && textOf(m).includes("broken"));
  return { chunks: [broken && !repairing ? "```json\n{ not json" : `\`\`\`json\n${JSON.stringify(NEWS_FLOW)}\n\`\`\``] };
}

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
  // Sends "ping from main" to the side chat with sendToChat (when the request offers it), then answers "sent".
  "mock/talker": {
    name: "Mock Talker",
    tools: true,
    turn: (o) =>
      !toolRanThisTurn(o) && offersTool(o, "sendToChat")
        ? { tool: { name: "sendToChat", input: { to: "side", message: "ping from main" } }, toolCallId: `mock-talk-${o.prompt.length}` }
        : { chunks: words("sent"), delayMs: 15 },
  },
  "mock/workflow": { name: "Mock Workflow", tools: true, turn: workflowTurn },
  "mock/flowgen": { name: "Mock Flow Generator", tools: false, turn: flowgenTurn },
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
