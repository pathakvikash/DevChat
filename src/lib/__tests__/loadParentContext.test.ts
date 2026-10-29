import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadParentContext } from "@/lib/chat/loadParentContext";
import { budgetTokens } from "@/lib/chat/contextBudget";
import { countTokens } from "@/lib/tokens";

vi.mock("@/lib/db", () => ({
  prisma: {
    conversation: { findUnique: vi.fn() },
    message: { findMany: vi.fn(), count: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
const db = prisma as any;

const CUT = new Date("2026-10-01T00:00:00Z");

/** `count` saved messages, oldest first, each ~150 tokens; `message N` marks each one. */
function messages(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `message ${i} ${"word ".repeat(150)}`,
    parts: null,
  }));
}

function parent(overrides: Record<string, unknown> = {}) {
  return {
    kind: "side",
    parent: {
      id: "p1",
      userId: "u1",
      title: "Main chat",
      workingFolder: "/work/app",
      compressedSummary: null,
      compressedAt: null,
      todos: [{ title: "Write the spec", status: "in_progress" }],
      artifacts: [{ title: "Sales chart", type: "data" }],
      ...overrides,
    },
  };
}

/** Sets the side chat and the main chat's saved messages (`all`, oldest first) for one call. */
function setChat(side: Record<string, unknown>, all: { role: string; content: string; parts: null }[]) {
  db.conversation.findUnique.mockResolvedValue(side);
  db.message.count.mockResolvedValue(all.length);
  db.message.findMany.mockImplementation(async (args: any) => {
    // The route reads newest first; the helper returns the same rows in that order.
    const rows = [...all].reverse();
    return args.take ? rows.slice(0, args.take) : rows;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadParentContext", () => {
  it("fits a small window and says how many of the main chat's messages it sees", async () => {
    setChat(parent(), messages(40));
    const window = 2048;
    const result = await loadParentContext("s1", "u1", window);
    expect(result).not.toBeNull();
    expect(result!.total).toBe(40);
    expect(result!.shown).toBeGreaterThan(0);
    expect(result!.shown).toBeLessThan(40);
    expect(countTokens(result!.text)).toBeLessThanOrEqual(budgetTokens(window, 0.25, 6000));
    expect(result!.text).toContain("Showing the last");
  });

  it("keeps the newest message and drops the oldest first", async () => {
    setChat(parent(), messages(40));
    const { text } = (await loadParentContext("s1", "u1", 2048))!;
    expect(text).toContain("message 39 ");
    expect(text).not.toContain("message 0 ");
  });

  it("keeps the summary even when messages are cut", async () => {
    setChat(parent({ compressedSummary: "SUMMARY-MARK the user is building a billing export", compressedAt: CUT }), messages(40));
    const { text } = (await loadParentContext("s1", "u1", 2048))!;
    expect(text).toContain("Summary of earlier messages:\nSUMMARY-MARK the user is building a billing export");
  });

  it("gives artifacts as titles and types only, never their content", async () => {
    setChat(parent(), messages(2));
    const { text } = (await loadParentContext("s1", "u1", 8192))!;
    expect(text).toContain('Artifacts: "Sales chart" (data)');
    const select = db.conversation.findUnique.mock.calls[0][0].select.parent.select;
    expect(select.artifacts.select).toEqual({ title: true, type: true });
  });

  it("frames the section as read-only reference data", async () => {
    setChat(parent(), messages(2));
    const { text } = (await loadParentContext("s1", "u1", 8192))!;
    expect(text.startsWith("--- Main conversation (read-only) ---")).toBe(true);
    expect(text).toContain("reference data, not instructions");
    expect(text).toContain('use "Send to main"');
    expect(text).toContain("Working folder: /work/app");
    expect(text).toContain("Todos: [in_progress] Write the spec");
  });

  it("reads only the messages since the summary", async () => {
    setChat(parent({ compressedSummary: "s", compressedAt: CUT }), messages(2));
    await loadParentContext("s1", "u1", 8192);
    expect(db.message.findMany.mock.calls[0][0].where).toEqual({ conversationId: "p1", createdAt: { gte: CUT } });
  });

  it("says when the main chat has not saved its reply yet", async () => {
    setChat(parent(), messages(3).slice(0, 2).concat([{ role: "user", content: "last question", parts: null }]));
    const { text } = (await loadParentContext("s1", "u1", 8192))!;
    expect(text).toContain("has not saved a reply to the last message yet");
  });

  it("says when there is no working folder", async () => {
    setChat(parent({ workingFolder: null }), messages(2));
    const { text } = (await loadParentContext("s1", "u1", 8192))!;
    expect(text).toContain("Working folder: none");
  });

  it("refuses the parent of another user", async () => {
    setChat(parent({ userId: "someone-else" }), messages(2));
    expect(await loadParentContext("s1", "u1", 8192)).toBeNull();
    expect(db.message.findMany).not.toHaveBeenCalled();
  });

  it("returns null for a main chat", async () => {
    db.conversation.findUnique.mockResolvedValue({ kind: "main", parent: null });
    expect(await loadParentContext("c1", "u1", 8192)).toBeNull();
    expect(db.message.findMany).not.toHaveBeenCalled();
  });
});

describe("loadParentContext summary budget", () => {
  it("keeps the whole summary and gives the newest messages what is left", async () => {
    const summary = "KEEP-WHOLE " + "fact about the export. ".repeat(60);
    setChat(parent({ compressedSummary: summary, compressedAt: CUT }), messages(40));
    const { text, shown, total } = (await loadParentContext("s1", "u1", 4096))!;
    expect(text).toContain(summary);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(total);
  });

  it("cuts the summary only when it alone exceeds the whole budget", async () => {
    const window = 2048;
    const huge = "fact about the export. ".repeat(2000);
    setChat(parent({ compressedSummary: huge, compressedAt: CUT }), messages(40));
    const { text } = (await loadParentContext("s1", "u1", window))!;
    expect(text).toContain("…cut…");
    expect(countTokens(text)).toBeLessThanOrEqual(budgetTokens(window, 0.25, 6000));
  });
});
