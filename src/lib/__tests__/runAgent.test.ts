import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { tool, type Tool } from "ai";
import { canStartSubAgents, runAgentTool, type SubAgentToolOptions } from "@/lib/chat/buildTools";
import { runSubAgent, type SubAgentOutput, type SubAgentResult } from "@/lib/chat/subAgent";
import { prisma } from "@/lib/db";
import type { ModelConfig } from "@/lib/models";

vi.mock("@/lib/db", () => ({
  prisma: {
    conversation: { create: vi.fn(), update: vi.fn() },
    message: { create: vi.fn(), findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/chat/subAgent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/subAgent")>()),
  runSubAgent: vi.fn(),
}));

const run = vi.mocked(runSubAgent);
const model = { id: "mock/subagent", supportsTools: true } as unknown as ModelConfig;
const fakeTool = () => tool({ description: "x", inputSchema: z.object({}) }) as Tool;
const parentTools = (): Record<string, Tool> => ({
  webSearch: fakeTool(),
  readFile: fakeTool(),
  createArtifact: fakeTool(),
  rememberFact: fakeTool(),
  mcp_docs_search: fakeTool(),
});

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
  report: "The folder has one note.",
  steps: 2,
  usage,
  transcript: [
    { id: "u", role: "user", parts: [{ type: "text", text: "task" }] },
    { id: "a", role: "assistant", parts: [{ type: "text", text: "The folder has one note." }] },
  ],
  ...over,
});

/** Runs the tool's execute the way the SDK does, and collects every yield. */
async function collect(t: Tool, input: object, signal = new AbortController().signal): Promise<SubAgentOutput[]> {
  const out: SubAgentOutput[] = [];
  const gen = (t.execute as any)(input, { toolCallId: "c1", messages: [], abortSignal: signal }) as AsyncIterable<SubAgentOutput>;
  for await (const v of gen) out.push(v);
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.conversation.create).mockResolvedValue({ id: "child-1" } as never);
  vi.mocked(prisma.conversation.update).mockResolvedValue({} as never);
  vi.mocked(prisma.message.create).mockResolvedValue({} as never);
  vi.mocked(prisma.message.findFirst).mockResolvedValue(null);
});

describe("canStartSubAgents", () => {
  it("offers runAgent only to a main chat whose model takes tools", () => {
    expect(canStartSubAgents("main", true)).toBe(true);
    expect(canStartSubAgents("main", false)).toBe(false);
  });

  it("never offers it to a side chat or a sub-agent run", () => {
    expect(canStartSubAgents("side", true)).toBe(false);
    expect(canStartSubAgents("subagent", true)).toBe(false);
    expect(canStartSubAgents(undefined, true)).toBe(false);
  });
});

describe("runAgentTool", () => {
  it("gives a helper the parent's tools in agent mode", async () => {
    run.mockResolvedValue(doneResult());
    await collect(runAgentTool(parentTools(), options({ mode: "agent" })), { task: "Read the notes" });
    const names = Object.keys(run.mock.calls[0][0].tools);
    expect(names).toEqual(expect.arrayContaining(["webSearch", "createArtifact", "rememberFact", "mcp_docs_search"]));
  });

  it.each(["ask", "plan", "chat"] as const)("gives a %s helper no mutating or MCP tools", async (mode) => {
    run.mockResolvedValue(doneResult());
    await collect(runAgentTool(parentTools(), options({ mode })), { task: "Read the notes" });
    const names = Object.keys(run.mock.calls[0][0].tools);
    expect(names).toEqual(expect.arrayContaining(["webSearch", "readFile"]));
    expect(names).not.toEqual(expect.arrayContaining(["createArtifact", "rememberFact", "mcp_docs_search"]));
  });

  it("runs the helper on the parent's model, mode and working folder", async () => {
    run.mockResolvedValue(doneResult());
    await collect(runAgentTool(parentTools(), options({ mode: "ask" })), { task: "Read the notes" });
    expect(run.mock.calls[0][0]).toMatchObject({ brief: "Read the notes", model, mode: "ask", workingFolder: "/work" });
  });

  it("saves each run as a kind=subagent child of the parent, with its transcript", async () => {
    run.mockResolvedValue(doneResult());
    await collect(runAgentTool(parentTools(), options()), { task: "Read the notes", title: "Note reader" });

    expect(prisma.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "u1", parentId: "parent-1", kind: "subagent", title: "Note reader", model: "mock/subagent" }),
      }),
    );
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ conversationId: "child-1", role: "user", content: "Read the notes" }) }),
    );
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ conversationId: "child-1", role: "assistant", content: "The folder has one note.", inputTokens: 40 }),
      }),
    );
    expect(prisma.conversation.update).toHaveBeenCalledWith(expect.objectContaining({ data: { totalTokens: { increment: 42 } } }));
  });

  it("returns the child id in the first output, and the report in the last", async () => {
    run.mockResolvedValue(doneResult());
    const outs = await collect(runAgentTool(parentTools(), options()), { task: "Read the notes" });
    expect(outs[0]).toMatchObject({ childId: "child-1", status: "running" });
    expect(outs.at(-1)).toMatchObject({ childId: "child-1", status: "done", report: "The folder has one note.", usage });
  });

  it("passes the parent's abort signal to the helper, and a stopped run is saved as stopped", async () => {
    const ac = new AbortController();
    run.mockImplementation(async (opts) => {
      await new Promise<void>((resolve) => opts.abortSignal.addEventListener("abort", () => resolve(), { once: true }));
      return doneResult({ status: "stopped", report: "partial", transcript: [
        { id: "u", role: "user", parts: [{ type: "text", text: "task" }] },
        { id: "a", role: "assistant", parts: [{ type: "text", text: "partial" }] },
      ] });
    });
    const pending = collect(runAgentTool(parentTools(), options()), { task: "Read the notes" }, ac.signal);
    await vi.waitFor(() => expect(run).toHaveBeenCalled());
    expect(run.mock.calls[0][0].abortSignal).toBe(ac.signal);
    ac.abort();
    const outs = await pending;
    expect(outs.at(-1)).toMatchObject({ status: "stopped", childId: "child-1" });
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "assistant", content: "partial" }) }),
    );
  });

  it("refuses a call past the parallel cap with an error output and no child", async () => {
    const finish: Array<() => void> = [];
    run.mockImplementation(() => new Promise<SubAgentResult>((resolve) => finish.push(() => resolve(doneResult()))));
    const t = runAgentTool(parentTools(), options({ maxParallel: 3 }));
    const first = [1, 2, 3].map(() => collect(t, { task: "Read the notes" }));
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(3));
    const refused = await collect(t, { task: "Read the notes" });
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ status: "error" });
    expect(refused[0].childId).toBeUndefined();
    expect(prisma.conversation.create).toHaveBeenCalledTimes(3);
    finish.forEach((f) => f());
    await Promise.all(first);
  });

  it("returns an error output, not a throw, when the child cannot be saved", async () => {
    vi.mocked(prisma.conversation.create).mockRejectedValueOnce(new Error("db down"));
    const outs = await collect(runAgentTool(parentTools(), options()), { task: "Read the notes" });
    expect(outs).toHaveLength(1);
    expect(outs[0]).toMatchObject({ status: "error", error: "Could not start the sub-agent." });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("runAgent progress and model output", () => {
  it("streams the helper's steps as the progress shape, then the final report", async () => {
    run.mockImplementation(async (opts) => {
      opts.onProgress?.({ type: "step started", step: 1 });
      opts.onProgress?.({ type: "tool call", step: 1, tool: "readFile", label: '{"p":"a.md"}' });
      opts.onProgress?.({ type: "tool result", step: 1, tool: "readFile", ok: true });
      opts.onProgress?.({ type: "text delta", chars: 12, preview: "Reading notes" });
      return doneResult({ steps: 1 });
    });
    const outs = await collect(runAgentTool(parentTools(), options()), { task: "Read the notes" });
    const running = outs.find((o) => o.step === 1 && o.steps.length === 1);
    expect(running?.steps[0]).toEqual({ tool: "readFile", label: '{"p":"a.md"}', state: "done" });
    expect(running?.preview).toBe("Reading notes");
    expect(outs.at(-1)).toMatchObject({ status: "done", step: 1, hitStepLimit: undefined });
  });

  it("marks the card's final output at the step limit", async () => {
    run.mockResolvedValue(doneResult({ steps: 15 }));
    const outs = await collect(runAgentTool(parentTools(), options()), { task: "Read the notes" });
    expect(outs.at(-1)).toMatchObject({ status: "done", hitStepLimit: true });
  });

  it("sends the parent the report for a done run and an error for the rest", () => {
    const t = runAgentTool(parentTools(), options());
    const toModel = (t as unknown as { toModelOutput: (a: { output: unknown }) => unknown }).toModelOutput;
    const done = toModel({ output: { childId: "child-1", title: "t", status: "done", startedAt: 0, step: 1, steps: [], report: "Found it." } });
    expect(done).toEqual({ type: "text", value: "Sub-agent child-1 report:\nFound it." });
    for (const status of ["running", "stopped", "timeout", "error"]) {
      const out = toModel({ output: { childId: "child-1", title: "t", status, startedAt: 0, step: 0, steps: [], error: "boom" } });
      expect(out).toMatchObject({ type: "error-text", value: expect.stringContaining("Sub-agent child-1") });
    }
  });
});
