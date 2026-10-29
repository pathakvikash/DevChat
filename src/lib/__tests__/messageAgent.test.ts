import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { tool, type Tool } from "ai";
import { messageAgentTool, type SubAgentToolOptions } from "@/lib/chat/buildTools";
import { runSubAgent, type SubAgentOutput, type SubAgentResult } from "@/lib/chat/subAgent";
import { prisma } from "@/lib/db";
import type { ModelConfig } from "@/lib/models";

vi.mock("@/lib/db", () => ({
  prisma: {
    conversation: { findFirst: vi.fn(), findUnique: vi.fn() },
    message: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("@/lib/chat/subAgent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/subAgent")>()),
  runSubAgent: vi.fn(),
}));

const db = prisma as any;
const run = vi.mocked(runSubAgent);
const model = { id: "mock/subagent", supportsTools: true } as unknown as ModelConfig;
const fakeTool = () => tool({ description: "x", inputSchema: z.object({}) }) as Tool;
const options = (over: Partial<SubAgentToolOptions> = {}): SubAgentToolOptions => ({
  userId: "u1",
  parentId: "parent-1",
  model,
  mode: "agent",
  workingFolder: "/work",
  maxParallel: 3,
  ...over,
});
const usage = { inputTokens: 40, outputTokens: 2 };
const doneResult = (over: Partial<SubAgentResult> = {}): SubAgentResult => ({
  status: "done",
  report: "Two notes now.",
  steps: 1,
  usage,
  transcript: [],
  ...over,
});
const savedRow = (id: string, role: string, text: string, at: string) => ({
  id,
  role,
  content: text,
  parts: JSON.stringify([{ type: "text", text }]),
  createdAt: new Date(at),
});

/** Runs the tool's execute the way the SDK does, and collects every yield. */
async function collect(t: Tool, input: object): Promise<SubAgentOutput[]> {
  const out: SubAgentOutput[] = [];
  const gen = (t.execute as any)(input, { toolCallId: "c1", messages: [], abortSignal: new AbortController().signal }) as AsyncIterable<SubAgentOutput>;
  for await (const v of gen) out.push(v);
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.conversation.findFirst.mockResolvedValue({ id: "child-1", title: "Note reader" });
  db.conversation.findUnique.mockResolvedValue({ title: "Main chat" });
  db.message.findMany.mockResolvedValue([
    savedRow("m1", "user", "Read the notes.", "2026-10-30T10:00:00Z"),
    savedRow("m2", "assistant", "The folder has one note.", "2026-10-30T10:00:05Z"),
  ]);
  db.message.findFirst.mockResolvedValue(null);
  db.message.create.mockResolvedValue({});
  run.mockResolvedValue(doneResult());
});

describe("messageAgent", () => {
  it("resumes a helper of this chat from its saved messages, with the new one, on a new card", async () => {
    const outs = await collect(messageAgentTool({ webSearch: fakeTool() }, options()), {
      agentId: "child-1",
      message: "Now check the second folder.",
    });

    expect(db.conversation.findFirst.mock.calls[0][0].where).toEqual({
      id: "child-1",
      parentId: "parent-1",
      kind: "subagent",
      userId: "u1",
    });
    expect(run).toHaveBeenCalledOnce();
    const arg = run.mock.calls[0][0];
    expect(arg.resume?.history.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(arg.resume?.message.parts).toEqual([
      { type: "data-agent-message", data: { from: "parent", fromConversationId: "parent-1", fromTitle: "Main chat", hop: 1 } },
      { type: "text", text: "Now check the second folder." },
    ]);
    expect(db.message.create.mock.calls[0][0].data).toMatchObject({
      conversationId: "child-1",
      role: "user",
      content: "Now check the second folder.",
    });
    expect(outs.at(-1)).toMatchObject({ childId: "child-1", status: "done", report: "Two notes now." });
  });

  it("refuses a helper that is not this chat's", async () => {
    db.conversation.findFirst.mockResolvedValue(null);
    const outs = await collect(messageAgentTool({}, options()), { agentId: "other-child", message: "Go on" });
    expect(outs.at(-1)).toMatchObject({ status: "error", error: "No sub-agent with that id in this chat." });
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses a helper already running in this request, without looking it up", async () => {
    const outs = await collect(messageAgentTool({}, options({ activeChildren: new Set(["child-1"]) })), {
      agentId: "child-1",
      message: "Go on",
    });
    expect(outs.at(-1)?.status).toBe("error");
    expect(db.conversation.findFirst).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("lets only one of two calls for the same helper in one step start", async () => {
    const t = messageAgentTool({}, options());
    const input = { agentId: "child-1", message: "Go on" };
    const [a, b] = await Promise.all([collect(t, input), collect(t, input)]);
    expect([a.at(-1)?.status, b.at(-1)?.status].sort()).toEqual(["done", "error"]);
    expect(run).toHaveBeenCalledOnce();
  });
});
