import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    message: { create: vi.fn(), updateMany: vi.fn() },
    conversation: { update: vi.fn() },
  },
}));

// Records the parts handed to normalization, where duplicate tool parts would show up.
const normalizeInputs = vi.hoisted(() => ({ seen: [] as unknown[][] }));
vi.mock("@/lib/chat/normalizeToolParts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat/normalizeToolParts")>();
  return {
    ...actual,
    normalizeToolParts: (parts: unknown) => {
      normalizeInputs.seen.push(parts as unknown[]);
      return actual.normalizeToolParts(parts);
    },
  };
});

import { prisma } from "@/lib/db";
import {
  safePersistAssistantMessage,
  type PersistAssistantMessageOptions,
} from "@/lib/chat/persistAssistantMessage";

const opts: PersistAssistantMessageOptions = { conversationId: "c1", model: "m" };
const done = { steps: [{ text: "hi" }] };
const savedParts = () => JSON.parse(vi.mocked(prisma.message.create).mock.calls[0][0].data.parts as string);

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(prisma.message.create).mockResolvedValue({} as any);
  vi.mocked(prisma.message.updateMany).mockResolvedValue({ count: 1 });
  vi.mocked(prisma.conversation.update).mockResolvedValue({} as any);
});

describe("safePersistAssistantMessage", () => {
  it("saves the message under the given id and resolves true", async () => {
    await expect(safePersistAssistantMessage(done, { ...opts, messageId: "a1" })).resolves.toBe(true);

    expect(prisma.message.create).toHaveBeenCalledExactlyOnceWith({
      data: expect.objectContaining({ id: "a1", conversationId: "c1", role: "assistant" }),
    });
  });

  it("updates the continued message's row instead of adding a copy", async () => {
    await safePersistAssistantMessage(done, { ...opts, messageId: "a1", updateExisting: true });

    expect(prisma.message.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: "a1", conversationId: "c1" },
      data: expect.objectContaining({ inputTokens: { increment: 0 }, outputTokens: { increment: 0 } }),
    });
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it("creates the continued message's row when it was never saved", async () => {
    vi.mocked(prisma.message.updateMany).mockResolvedValue({ count: 0 });

    await safePersistAssistantMessage(done, { ...opts, messageId: "a1", updateExisting: true });

    expect(prisma.message.create).toHaveBeenCalledExactlyOnceWith({
      data: expect.objectContaining({ id: "a1", conversationId: "c1", role: "assistant" }),
    });
  });

  it("marks a tool call that never got a result as errored, as a stopped turn leaves it", async () => {
    const dangling = { type: "tool-executeCode", toolCallId: "t1", state: "input-available", input: {} };

    await safePersistAssistantMessage({ steps: [] }, { ...opts, overrideParts: [dangling] });

    expect(savedParts()).toEqual([expect.objectContaining({ toolCallId: "t1", state: "output-error" })]);
  });

  it("swallows errors, reports them via onError and resolves false", async () => {
    const err = new Error("db down");
    vi.mocked(prisma.message.create).mockRejectedValue(err);
    const onError = vi.fn();

    await expect(safePersistAssistantMessage(done, { ...opts, onError })).resolves.toBe(false);

    expect(onError).toHaveBeenCalledWith(err);
  });
  it("puts queued text into content in order, between the reply's texts", async () => {
    await safePersistAssistantMessage(done, {
      ...opts,
      overrideParts: [
        { type: "text", text: "First." },
        { type: "data-queued-message", id: "q1", data: { queuedId: "q1", text: "Change course" } },
        { type: "text", text: "Second." },
      ],
    });

    expect(vi.mocked(prisma.message.create).mock.calls[0][0].data.content).toBe(
      "First.\n\nChange course\n\nSecond.",
    );
    expect(savedParts()).toEqual([
      { type: "text", text: "First." },
      { type: "data-queued-message", id: "q1", data: { queuedId: "q1", text: "Change course" } },
      { type: "text", text: "Second." },
    ]);
  });

  it("hands normalization one part per tool call when the stream's parts are passed in", async () => {
    const done2 = {
      steps: [
        {
          text: "",
          toolCalls: [{ toolCallId: "t1", toolName: "webSearch", input: { query: "q" } }],
          toolResults: [{ toolCallId: "t1", toolName: "webSearch", output: "ok" }],
        },
      ],
    };
    const streamed = {
      type: "tool-webSearch",
      toolCallId: "t1",
      toolName: "webSearch",
      input: { query: "q" },
      output: "ok",
      state: "output-available",
    };

    await safePersistAssistantMessage(done2, { ...opts, overrideParts: [streamed] });

    const handed = normalizeInputs.seen.at(-1) as Array<{ toolCallId?: string }>;
    expect(handed.filter((p) => p.toolCallId === "t1")).toHaveLength(1);
    expect(savedParts()).toEqual([expect.objectContaining({ toolCallId: "t1", state: "output-available" })]);
  });
});

describe("approval states survive saving", () => {
  it("keeps an unanswered approval as the saved reply has it, with no second copy", async () => {
    const waiting = {
      type: "tool-createArtifact",
      toolCallId: "c1",
      state: "approval-requested",
      input: { title: "Notes" },
      approval: { id: "ap1" },
    };
    const step = { text: "", toolCalls: [{ toolCallId: "c1", toolName: "createArtifact", input: { title: "Notes" } }], toolResults: [] };

    await safePersistAssistantMessage({ steps: [step] }, { ...opts, overrideParts: [waiting] });

    expect(savedParts()).toEqual([expect.objectContaining({ toolCallId: "c1", state: "approval-requested", approval: { id: "ap1" } })]);
    expect(savedParts()).toHaveLength(1);
  });

  it("keeps an allowed call's approval state after the tool runs", async () => {
    const responded = {
      type: "tool-createArtifact",
      toolCallId: "c1",
      state: "output-available",
      input: { title: "Notes" },
      output: "Artifact created: a1",
      approval: { id: "ap1", approved: true },
    };
    const step = {
      text: "",
      toolCalls: [{ toolCallId: "c1", toolName: "createArtifact", input: { title: "Notes" } }],
      toolResults: [{ toolCallId: "c1", toolName: "createArtifact", output: "Artifact created: a1" }],
    };

    await safePersistAssistantMessage({ steps: [step] }, { ...opts, overrideParts: [responded] });

    expect(savedParts()).toEqual([expect.objectContaining({ toolCallId: "c1", state: "output-available", approval: { id: "ap1", approved: true } })]);
  });
});
