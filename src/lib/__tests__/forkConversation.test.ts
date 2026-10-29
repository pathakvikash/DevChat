import { describe, it, expect, vi, beforeEach } from "vitest";
import { forkConversation, rewriteArtifactIds } from "@/lib/forkConversation";

vi.mock("@/lib/db", () => ({ prisma: { $transaction: vi.fn() } }));

import { prisma } from "@/lib/db";
const db = prisma as any;

const tx = {
  conversation: { findFirst: vi.fn(), create: vi.fn() },
  message: { findFirst: vi.fn(), findMany: vi.fn(), createMany: vi.fn() },
  artifact: { create: vi.fn() },
};

const t1 = new Date("2026-10-30T10:00:00Z");
const t2 = new Date("2026-10-30T10:01:00Z");
const t3 = new Date("2026-10-30T10:02:00Z");

const source = (over: Record<string, unknown> = {}) => ({
  id: "src",
  userId: "user-1",
  title: "Plan",
  model: "ollama/llama",
  persona: "analyst",
  systemPrompt: "be terse",
  kbId: "kb-1",
  webSearch: true,
  temperature: 0.3,
  maxTokens: 900,
  contextLength: 4096,
  topP: 0.9,
  chatOnlyMode: true,
  memoryDisabled: true,
  generativeUiEnabled: true,
  temporary: false,
  maxToolCalls: 7,
  reasoningEffort: "high",
  workingFolder: "/work",
  fallbackModel: "gpt-4o",
  compressedSummary: null,
  compressedAt: null,
  compressedBeforeTokens: null,
  compressedAfterTokens: null,
  compressedBeforeMessages: null,
  pinned: true,
  archived: true,
  note: "keep",
  artifacts: [],
  ...over,
});

const msg = (id: string, createdAt: Date, parts: string | null = null) => ({
  id,
  conversationId: "src",
  role: id.startsWith("u") ? "user" : "assistant",
  content: `text of ${id}`,
  systemPrompt: null,
  parts,
  attachments: null,
  inputTokens: 3,
  outputTokens: 4,
  model: "m",
  createdAt,
});

/** Sets up a chat with the given source, target message and the messages the fork will read. */
function arrange(src: ReturnType<typeof source>, target: ReturnType<typeof msg>, found = [target]) {
  tx.conversation.findFirst.mockResolvedValue(src);
  tx.message.findFirst.mockResolvedValue(target);
  tx.message.findMany.mockResolvedValue(found);
}

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation((fn: (client: unknown) => unknown) => fn(tx));
  tx.conversation.create.mockResolvedValue({ id: "fork-1" });
  tx.artifact.create.mockImplementation(async ({ data }: { data: { title: string } }) => ({
    id: `new-${data.title}`,
  }));
  tx.message.createMany.mockResolvedValue({ count: 0 });
});

describe("forkConversation: messages", () => {
  it("reads messages up to and including the target, oldest first", async () => {
    const [m1, m2, m3] = [msg("u1", t1), msg("a1", t2), msg("u2", t3)];
    arrange(source(), m3, [m1, m2, m3]);

    expect(await forkConversation("user-1", "src", "u2")).toEqual({ ok: true, id: "fork-1" });
    expect(tx.message.findMany).toHaveBeenCalledWith({
      where: { conversationId: "src" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(tx.message.createMany.mock.calls[0][0].data).toHaveLength(3);
  });

  it("cuts by position, so a later message with the same timestamp is left out", async () => {
    const [m1, m2, m3] = [msg("u1", t1), msg("a1", t1), msg("u2", t1)];
    arrange(source(), m2, [m1, m2, m3]);

    await forkConversation("user-1", "src", "a1");
    const rows = tx.message.createMany.mock.calls[0][0].data;
    expect(rows.map((r: any) => r.content)).toEqual(["text of u1", "text of a1"]);
  });

  it("copies each message with its order, timestamp and fields, under the new chat, with new ids", async () => {
    const [m1, m2] = [msg("u1", t1), msg("a1", t2)];
    arrange(source(), m2, [m1, m2]);

    await forkConversation("user-1", "src", "a1");
    const rows = tx.message.createMany.mock.calls[0][0].data;
    expect(rows.map((r: any) => r.content)).toEqual(["text of u1", "text of a1"]);
    expect(rows[0].createdAt).toEqual(t1);
    expect(rows[1].createdAt).toEqual(t2);
    expect(rows.every((r: any) => r.conversationId === "fork-1" && !("id" in r))).toBe(true);
    expect(rows[1]).toMatchObject({
      role: "assistant",
      inputTokens: 3,
      outputTokens: 4,
      model: "m",
    });
  });

  it("refuses a message that is not in this chat", async () => {
    tx.conversation.findFirst.mockResolvedValue(source());
    tx.message.findFirst.mockResolvedValue(null);
    expect(await forkConversation("user-1", "src", "other")).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(tx.message.findFirst).toHaveBeenCalledWith({
      where: { id: "other", conversationId: "src" },
    });
    expect(tx.conversation.create).not.toHaveBeenCalled();
  });
});

describe("forkConversation: parts and artifacts", () => {
  it("copies artifacts with new ids and rewrites only the artifact ids in the copied parts", async () => {
    const parts =
      '[{"type":"tool-createArtifact","input":{"artifactId":"art-a"}},{"type":"text","text":"a chart"}]';
    const artifact = {
      id: "art-a",
      type: "html",
      title: "Chart",
      content: "<p/>",
      version: 2,
      createdAt: t1,
    };
    arrange(source({ artifacts: [artifact] }), msg("a1", t2, parts), [msg("a1", t2, parts)]);

    await forkConversation("user-1", "src", "a1");
    expect(tx.artifact.create).toHaveBeenCalledWith({
      data: { conversationId: "fork-1", type: "html", title: "Chart", content: "<p/>", version: 2 },
    });
    const copied = tx.message.createMany.mock.calls[0][0].data[0].parts;
    expect(copied).toBe(parts.split("art-a").join("new-Chart"));
  });

  it("copies only the artifacts that existed at the fork point", async () => {
    const before = {
      id: "art-old",
      type: "html",
      title: "Old",
      content: "a",
      version: 1,
      createdAt: t1,
    };
    const after = {
      id: "art-new",
      type: "html",
      title: "New",
      content: "b",
      version: 1,
      createdAt: t3,
    };
    arrange(source({ artifacts: [before, after] }), msg("a1", t2), [msg("a1", t2)]);

    await forkConversation("user-1", "src", "a1");
    expect(tx.artifact.create).toHaveBeenCalledTimes(1);
    expect(tx.artifact.create.mock.calls[0][0].data.title).toBe("Old");
  });
});

describe("forkConversation: settings and summary", () => {
  it("copies the settings and links the fork to its source, without the other flags", async () => {
    arrange(source(), msg("u1", t1), [msg("u1", t1)]);
    await forkConversation("user-1", "src", "u1");

    const data = tx.conversation.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      userId: "user-1",
      title: "Plan (fork)",
      forkedFromId: "src",
      model: "ollama/llama",
      persona: "analyst",
      systemPrompt: "be terse",
      kbId: "kb-1",
      webSearch: true,
      temperature: 0.3,
      maxTokens: 900,
      contextLength: 4096,
      topP: 0.9,
      chatOnlyMode: true,
      memoryDisabled: true,
      generativeUiEnabled: true,
      maxToolCalls: 7,
      reasoningEffort: "high",
      workingFolder: "/work",
      fallbackModel: "gpt-4o",
    });
    expect(data).not.toHaveProperty("pinned");
    expect(data).not.toHaveProperty("archived");
    expect(data).not.toHaveProperty("note");
  });

  it("makes a saved chat with memory at its defaults, even from a temporary source", async () => {
    arrange(source({ temporary: true, memoryDisabled: true }), msg("u1", t1), [msg("u1", t1)]);
    expect(await forkConversation("user-1", "src", "u1")).toEqual({ ok: true, id: "fork-1" });

    expect(tx.conversation.create.mock.calls[0][0].data).toMatchObject({
      temporary: false,
      memoryDisabled: false,
    });
    // The source is only read, never changed: it stays temporary and is still deleted when left.
    expect(tx.conversation.create).toHaveBeenCalledTimes(1);
    expect(tx.conversation.findFirst).toHaveBeenCalledTimes(1);
  });

  it("keeps memory off for a saved source that has it off", async () => {
    arrange(source({ temporary: false, memoryDisabled: true }), msg("u1", t1), [msg("u1", t1)]);
    await forkConversation("user-1", "src", "u1");
    expect(tx.conversation.create.mock.calls[0][0].data).toMatchObject({
      temporary: false,
      memoryDisabled: true,
    });
  });

  it("copies the summary when compression happened at or before the fork point", async () => {
    const summary = {
      compressedSummary: "earlier",
      compressedAt: t2,
      compressedBeforeTokens: 900,
      compressedAfterTokens: 200,
      compressedBeforeMessages: 6,
    };
    arrange(source(summary), msg("u2", t3), [msg("u1", t1), msg("u2", t3)]);
    await forkConversation("user-1", "src", "u2");
    expect(tx.conversation.create.mock.calls[0][0].data).toMatchObject({ ...summary });
  });

  it("gives no summary when compression came after the fork point", async () => {
    arrange(source({ compressedSummary: "later", compressedAt: t3 }), msg("u1", t1), [
      msg("u1", t1),
    ]);
    await forkConversation("user-1", "src", "u1");
    const data = tx.conversation.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("compressedSummary");
    expect(data).not.toHaveProperty("compressedAt");
  });
});

describe("forkConversation: ownership", () => {
  it("looks the source up by owner and refuses another user's chat", async () => {
    tx.conversation.findFirst.mockResolvedValue(null);
    expect(await forkConversation("user-2", "src", "u1")).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(tx.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: "src", userId: "user-2" },
      include: { artifacts: true },
    });
    expect(tx.conversation.create).not.toHaveBeenCalled();
    expect(tx.message.createMany).not.toHaveBeenCalled();
  });
});

describe("rewriteArtifactIds", () => {
  it("replaces every mapped id and passes null through", () => {
    const map = new Map([
      ["old-1", "new-1"],
      ["old-2", "new-2"],
    ]);
    expect(rewriteArtifactIds('{"a":"old-1","b":["old-2","old-1"]}', map)).toBe(
      '{"a":"new-1","b":["new-2","new-1"]}',
    );
    expect(rewriteArtifactIds(null, map)).toBeNull();
  });
});
