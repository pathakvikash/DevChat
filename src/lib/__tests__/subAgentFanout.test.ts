import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { tool, type Tool } from "ai";
import { messageAgentTool, runAgentTool, type SubAgentToolOptions } from "@/lib/chat/buildTools";
import { runSubAgent, type SubAgentResult } from "@/lib/chat/subAgent";
import { prisma } from "@/lib/db";
import type { ModelConfig } from "@/lib/models";

vi.mock("@/lib/db", () => ({
  prisma: {
    conversation: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    message: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock("@/lib/chat/subAgent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/subAgent")>()),
  runSubAgent: vi.fn(),
}));

const db = prisma as any;
const run = vi.mocked(runSubAgent);
const model = { id: "m", supportsTools: true } as unknown as ModelConfig;
const parentTools = { webSearch: tool({ description: "x", inputSchema: z.object({}) }) as Tool };
const options = (maxParallel: number): SubAgentToolOptions => ({
  userId: "u",
  parentId: "p",
  model,
  mode: "agent",
  maxParallel,
  activeChildren: new Set(),
});

let live = 0;
let peak = 0;
let release!: () => void;

beforeEach(() => {
  live = 0;
  peak = 0;
  const gate = new Promise<void>((r) => (release = r));
  let n = 0;
  db.conversation.create.mockImplementation(async () => ({ id: `new-${++n}` }));
  db.conversation.update.mockResolvedValue({});
  db.conversation.findFirst.mockImplementation(async ({ where }: any) => ({ id: where.id, title: "old" }));
  db.conversation.findUnique.mockResolvedValue({ title: "Main" });
  db.message.findMany.mockResolvedValue([]);
  db.message.findFirst.mockResolvedValue(null);
  db.message.create.mockResolvedValue({});
  run.mockImplementation(async (): Promise<SubAgentResult> => {
    live++;
    peak = Math.max(peak, live);
    await gate;
    live--;
    return { status: "done", report: "r", steps: 1, usage: { inputTokens: 0, outputTokens: 0 }, transcript: [] };
  });
});

const drain = async (t: Tool, input: object) => {
  const gen = (t.execute as any)(input, { toolCallId: "c", messages: [], abortSignal: new AbortController().signal });
  let last: any;
  for await (const v of gen) last = v;
  return last;
};

describe("helper fan-out cap", () => {
  it("runAgent and messageAgent started in one step share the cap", async () => {
    const opts = options(3);
    const ra = runAgentTool(parentTools, opts);
    const ma = messageAgentTool(parentTools, opts);
    const calls = [
      drain(ma, { agentId: "c1", message: "x" }),
      drain(ma, { agentId: "c2", message: "x" }),
      drain(ma, { agentId: "c3", message: "x" }),
      drain(ra, { task: "a" }),
      drain(ra, { task: "b" }),
      drain(ra, { task: "c" }),
    ];
    await new Promise((r) => setTimeout(r, 20));
    const seen = peak;
    release();
    const outs = await Promise.all(calls);
    expect(seen).toBe(3);
    expect(outs.map((o) => o.status)).toEqual(["done", "done", "done", "error", "error", "error"]);
  });

  it("a finished or refused call frees its slot", async () => {
    const opts = options(1);
    const ra = runAgentTool(parentTools, opts);
    const ma = messageAgentTool(parentTools, opts);
    release();
    expect((await drain(ma, { agentId: "c1", message: "x" })).status).toBe("done");
    expect((await drain(ra, { task: "a" })).status).toBe("done");
    // A follow-up for a helper that is not this chat's refuses after its slot was taken, and gives it back.
    db.conversation.findFirst.mockResolvedValueOnce(null);
    expect((await drain(ma, { agentId: "gone", message: "x" })).status).toBe("error");
    expect((await drain(ra, { task: "b" })).status).toBe("done");
  });
});
