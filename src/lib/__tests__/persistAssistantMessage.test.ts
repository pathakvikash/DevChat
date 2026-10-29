import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    message: { create: vi.fn(), updateMany: vi.fn() },
    conversation: { update: vi.fn() },
  },
}));

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
});
