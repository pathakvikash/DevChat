import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { message: { findMany: vi.fn() } } }));

import { prisma } from "@/lib/db";
import { chatsThatReadFiles, conversationReadFiles } from "@/lib/files/readFiles";

const find = vi.mocked(prisma.message.findMany) as any;
beforeEach(() => vi.clearAllMocks());

describe("conversationReadFiles", () => {
  it("looks for the three folder tools in the chat and in the helper runs it started", async () => {
    find.mockResolvedValue([{ id: "m1" }]);
    expect(await conversationReadFiles("c1")).toBe(true);
    const where = find.mock.calls[0][0].where;
    expect(where.OR.map((c: any) => c.parts.contains)).toEqual(['"tool-listFiles"', '"tool-readFile"', '"tool-searchFiles"']);
    expect(where.conversation).toEqual({ OR: [{ id: "c1" }, { parentId: "c1" }] });
    find.mockResolvedValue([]);
    expect(await conversationReadFiles("c1")).toBe(false);
  });
});

describe("chatsThatReadFiles", () => {
  it("is one query for the user, and adds the parent of a helper run that read files", async () => {
    find.mockResolvedValue([
      { conversationId: "a", conversation: { parentId: null } },
      { conversationId: "kid", conversation: { parentId: "p" } },
      { conversationId: "kid2", conversation: { parentId: "p" } },
    ]);
    expect(await chatsThatReadFiles("u1")).toEqual(["a", "kid", "p", "kid2"]);
    expect(find).toHaveBeenCalledTimes(1);
    expect(find.mock.calls[0][0].where.conversation).toEqual({ userId: "u1" });
  });
});
