import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: { message: { findFirst: vi.fn(), create: vi.fn() } },
}));

import { prisma } from "@/lib/db";
import { saveUserMessage } from "@/lib/chat/saveUserMessage";

const base = { conversationId: "c1", text: "hi", parts: [{ type: "text", text: "hi" }] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(prisma.message.create).mockResolvedValue({} as any);
});

describe("saveUserMessage", () => {
  it("saves under the client's id", async () => {
    vi.mocked(prisma.message.findFirst).mockResolvedValue(null);

    await saveUserMessage({ ...base, id: "u1" });

    expect(prisma.message.findFirst).toHaveBeenCalledExactlyOnceWith({
      where: { id: "u1", conversationId: "c1" },
      select: { id: true },
    });
    expect(prisma.message.create).toHaveBeenCalledExactlyOnceWith({
      data: expect.objectContaining({ id: "u1", conversationId: "c1", role: "user", content: "hi" }),
    });
  });

  it("skips the save when a row with that id exists, as on regenerate", async () => {
    vi.mocked(prisma.message.findFirst).mockResolvedValue({ id: "u1" } as any);

    await saveUserMessage({ ...base, id: "u1" });

    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it("saves the same text again under a new id", async () => {
    vi.mocked(prisma.message.findFirst).mockResolvedValue(null);

    await saveUserMessage({ ...base, id: "u2" });

    expect(prisma.message.create).toHaveBeenCalledTimes(1);
  });

  it("without an id, skips text equal to the last saved user message", async () => {
    vi.mocked(prisma.message.findFirst).mockResolvedValue({ content: "hi" } as any);

    await saveUserMessage(base);

    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it("hides the database error from the client", async () => {
    vi.mocked(prisma.message.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.message.create).mockRejectedValue(new Error("Unique constraint failed on the fields: (`id`)"));

    await expect(saveUserMessage({ ...base, id: "u1" })).rejects.toThrow("Couldn't save your message. Try again.");
  });
});
