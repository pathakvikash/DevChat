import { describe, it, expect, vi, beforeEach } from "vitest";

const create = vi.fn(async (_a: any) => ({ id: "m1" }));
vi.mock("@/lib/db", () => ({
  prisma: { conversation: { create: vi.fn(async () => ({ id: "c1" })), update: vi.fn(async () => ({})), findFirst: vi.fn() }, message: { create: (a: any) => create(a) } },
}));
vi.mock("@/lib/settings", () => ({ getSettingsKey: vi.fn(async () => "") }));

import { chatMessageCard } from "@/lib/workflows/cards/chatMessage";
import { READ_FILES_MARKER } from "@/lib/files/folderTools";
import type { CardCtx } from "@/lib/workflows/cards";

const ctx = (readsFolder?: boolean): CardCtx => ({
  userId: "u1",
  workflowId: "wf1",
  node: { id: "post", type: "chatMessage", fromIds: [], config: {}, ui: { label: "Post", position: { x: 0, y: 0 } } },
  config: { message: "hello", chat: "new" },
  tctx: { nodes: {}, vars: {}, run: { id: "r", date: "2026-11-12", startedAt: "" }, workflow: { name: "WF" } },
  defaultModel: "m",
  readsFolder,
  signal: new AbortController().signal,
});

beforeEach(() => create.mockClear());

describe("Post to a chat", () => {
  it("stores the folder marker on the agent-message part when a folder card fed it", async () => {
    await chatMessageCard.run(ctx(true));
    expect(create.mock.calls[0][0].data.parts).toContain(READ_FILES_MARKER);
  });

  it("stores no marker for a post with no folder ancestor", async () => {
    await chatMessageCard.run(ctx(false));
    await chatMessageCard.run(ctx());
    for (const call of create.mock.calls) expect(call[0].data.parts).not.toContain("readFiles");
  });
});
