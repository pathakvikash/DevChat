import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildSystemPrompt } from "@/lib/chat/buildSystemPrompt";

vi.mock("@/lib/db", () => ({
  prisma: {
    document: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/rag", () => ({
  embed: vi.fn().mockResolvedValue(new Array(384).fill(0.5)),
  cosineSimilarity: vi.fn().mockReturnValue(0.5),
}));

vi.mock("@/lib/memory", () => ({
  getMemoryBlock: vi.fn(),
}));

vi.mock("@/lib/compression", () => ({
  getCompressedContext: vi.fn(),
}));

vi.mock("@/lib/settings", () => ({
  getSettingsKey: vi.fn(),
}));

vi.mock("@/lib/utils/messageParts", () => ({
  extractText: vi.fn(),
}));

import { getMemoryBlock } from "@/lib/memory";
import { getCompressedContext } from "@/lib/compression";

beforeEach(() => {
  vi.clearAllMocks();
});

const makeOpts = (overrides: Record<string, any> = {}) => ({
  useTools: false,
  systemPrompt: "",
  skillIds: [],
  activeToolIds: new Set<string>(),
  conversationId: undefined,
  kbId: undefined,
  ragContext: undefined,
  messages: [],
  userId: "test-user",
  ...overrides,
});

describe("buildSystemPrompt", () => {
  it("returns base prompt for empty opts", async () => {
    (getMemoryBlock as any).mockResolvedValue("");
    const result = await buildSystemPrompt(makeOpts());
    expect(result.text).toBeTruthy();
    expect(result.sections).toHaveProperty("base");
    expect(result.sections).toHaveProperty("persona");
    expect(result.sections).toHaveProperty("skills");
    expect(result.sections).toHaveProperty("tools");
    expect(result.sections).toHaveProperty("memory");
    expect(result.sections).toHaveProperty("compressed");
    expect(result.sections).toHaveProperty("kb");
  });

  it("includes persona section when systemPrompt provided", async () => {
    (getMemoryBlock as any).mockResolvedValue("");
    const result = await buildSystemPrompt(
      makeOpts({ systemPrompt: "You are a code expert." }),
    );
    expect(result.sections.persona).toContain("You are a code expert.");
    expect(result.text).toContain("You are a code expert.");
  });

  it("omits persona section when systemPrompt is empty", async () => {
    (getMemoryBlock as any).mockResolvedValue("");
    const result = await buildSystemPrompt(makeOpts({ systemPrompt: "" }));
    expect(result.sections.persona).toBeNull();
  });

  it("includes memory block when present", async () => {
    (getMemoryBlock as any).mockResolvedValue("User likes TypeScript.");
    const result = await buildSystemPrompt(makeOpts());
    expect(result.sections.memory).toBe("User likes TypeScript.");
    expect(result.text).toContain("User likes TypeScript.");
  });

  it("has empty memory section block when memory is empty", async () => {
    (getMemoryBlock as any).mockResolvedValue("");
    const result = await buildSystemPrompt(makeOpts());
    expect(result.sections.memory).toBe("");
  });

  it("includes compressed context when conversationId provided", async () => {
    (getMemoryBlock as any).mockResolvedValue("");
    (getCompressedContext as any).mockResolvedValue("Compressed summary text");

    const result = await buildSystemPrompt(makeOpts({ conversationId: "conv-1" }));
    expect(result.sections.compressed).toContain("Compressed summary text");
    expect(result.text).toContain("Compressed Conversation History");
  });

  it("has null compressed when conversationId provided but no summary", async () => {
    (getMemoryBlock as any).mockResolvedValue("");
    (getCompressedContext as any).mockResolvedValue(null);

    const result = await buildSystemPrompt(makeOpts({ conversationId: "conv-1" }));
    expect(result.sections.compressed).toBeNull();
  });

  it("uses tools section when useTools is true", async () => {
    (getMemoryBlock as any).mockResolvedValue("");
    const result = await buildSystemPrompt(makeOpts({ useTools: true }));
    expect(result.sections.base).toContain("executeCode");
  });

  it("uses chat-only prompt when useTools is false", async () => {
    (getMemoryBlock as any).mockResolvedValue("");
    const result = await buildSystemPrompt(makeOpts({ useTools: false }));
    expect(result.sections.base).toContain("chat-only");
    expect(result.sections.base).not.toContain("executeCode");
  });

  it("includes KB section when searchKnowledgeBase tool is active", async () => {
    (getMemoryBlock as any).mockResolvedValue("");
    const result = await buildSystemPrompt(
      makeOpts({
        useTools: true,
        activeToolIds: new Set(["searchKnowledgeBase"]),
      }),
    );
    expect(result.sections.base).toContain("KNOWLEDGE BASE");
  });

  it("returns null persona for whitespace-only systemPrompt", async () => {
    (getMemoryBlock as any).mockResolvedValue("");
    const result = await buildSystemPrompt(makeOpts({ systemPrompt: "   " }));
    expect(result.sections.persona).toBeNull();
  });

  it("includes skills section when skillIds provided", async () => {
    (getMemoryBlock as any).mockResolvedValue("");
    const result = await buildSystemPrompt(
      makeOpts({ skillIds: ["data-analyst"] }),
    );
    expect(result.sections.skills).toContain("DATA ANALYST");
  });

  it("omits KB section when not attached and no ragContext", async () => {
    (getMemoryBlock as any).mockResolvedValue("");
    const result = await buildSystemPrompt(makeOpts());
    expect(result.sections.kb).toBeNull();
  });

  it("omits kb section when no kbId and no ragContext", async () => {
    (getMemoryBlock as any).mockResolvedValue("");
    const result = await buildSystemPrompt(makeOpts());
    expect(result.sections.kb).toBeNull();
    expect(result.sections.tools).toBeNull();
  });
});
