import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/conversations/[id]/messages/[messageId]/route";
import { READ_FILES_MARKER } from "@/lib/files/folderTools";

const update = vi.fn(async ({ data }: any) => ({ id: "m1", role: "user", content: data.content, createdAt: new Date() }));
vi.mock("@/lib/db", () => ({ prisma: { message: { update: (a: any) => update(a) } } }));
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn().mockResolvedValue("u1") }));
const lookup = vi.fn();
vi.mock("@/lib/api/messages", () => ({ findConversationMessage: (...a: unknown[]) => lookup(...a) }));

const patch = (parts: string | null) => {
  lookup.mockResolvedValue({ ok: true, message: { id: "m1", parts } });
  return PATCH(new NextRequest("http://localhost/x", { method: "PATCH", body: JSON.stringify({ content: "edited" }) }), { params: Promise.resolve({ id: "c1", messageId: "m1" }) });
};

describe("editing a message", () => {
  it("keeps the folder marker of a workflow's posted message", async () => {
    await patch(JSON.stringify([{ type: "data-agent-message", data: { from: "workflow", readFiles: true } }, { type: "text", text: "old" }]));
    expect(update.mock.calls[0][0].data.parts).toContain(READ_FILES_MARKER);
  });

  it("stores only the text of an ordinary message", async () => {
    update.mockClear();
    await patch(JSON.stringify([{ type: "text", text: "old" }]));
    expect(update.mock.calls[0][0].data.parts).toBe(JSON.stringify([{ type: "text", text: "edited" }]));
  });
});
