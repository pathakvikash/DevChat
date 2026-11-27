import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildSystemPrompt } from "@/lib/chat/buildSystemPrompt";
import { buildTools, resolveActiveToolIds } from "@/lib/chat/buildTools";
import { GENERATIVE_UI_STUB, shouldInlineUiGuide, uiGuideText } from "@/lib/generativeUi/guide";
import { TOOL_REGISTRY } from "@/lib/registry";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/rag", () => ({ searchKb: vi.fn(), REINGEST_NOTE: "" }));
vi.mock("@/lib/memory", () => ({ getMemoryBlock: vi.fn().mockResolvedValue("") }));
vi.mock("@/lib/compression", () => ({ getCompressedContext: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/chat/loadParentContext", () => ({ loadParentContext: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getSettingsKey: vi.fn() }));

const user = (text: string) => ({ role: "user", parts: [{ type: "text", text }] });
const opts = (o: Record<string, any> = {}) => ({
  useTools: false, skillIds: [], activeToolIds: new Set<string>(), messages: [user("hi")], userId: "u", ...o,
});

describe("shouldInlineUiGuide", () => {
  it("matches visual keywords in the latest user message", () => {
    expect(shouldInlineUiGuide([user("Compare these two")])).toBe(true);
    expect(shouldInlineUiGuide([user("show me the numbers")])).toBe(true);
    expect(shouldInlineUiGuide([user("what is a platform?")])).toBe(false);
    expect(shouldInlineUiGuide([user("chart it"), { role: "assistant", parts: [{ type: "text", text: "ok" }] }, user("thanks")])).toBe(false);
  });
  it("matches an existing spec fence or generative UI part", () => {
    expect(shouldInlineUiGuide([{ role: "assistant", parts: [{ type: "text", text: "```spec\n{}\n```" }] }, user("thanks")])).toBe(true);
    expect(shouldInlineUiGuide([{ role: "assistant", parts: [{ type: "data-spec" }] }, user("thanks")])).toBe(true);
  });
  it("is false for no messages", () => expect(shouldInlineUiGuide([])).toBe(false));
});

describe("generative UI in the system prompt", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tool models get only the stub", async () => {
    const r = await buildSystemPrompt(opts({ useTools: true }));
    expect(r.sections.generativeUi).toBe(GENERATIVE_UI_STUB);
    expect(r.text).toContain("loadUiGuide");
    expect(r.text).not.toContain(uiGuideText());
  });

  it("non-tool models get the full guide only on a keyword or an existing spec", async () => {
    expect((await buildSystemPrompt(opts())).sections.generativeUi).toBeNull();
    expect((await buildSystemPrompt(opts({ messages: [user("make a chart")] }))).sections.generativeUi).toBe(uiGuideText());
  });

  it("reports the size saving", () => {
    const full = uiGuideText().length;
    console.log(`ui guide chars: full=${full} stub=${GENERATIVE_UI_STUB.length}`);
    expect(GENERATIVE_UI_STUB.length).toBeLessThan(full / 10);
  });
});

describe("loadUiGuide tool", () => {
  it("returns the full guide, is read-only and active by default", async () => {
    const def = TOOL_REGISTRY.loadUiGuide;
    expect(def.mutates).toBe(false);
    expect(def.internal).toBe(true);
    expect(await def.execute!({}, {})).toBe(uiGuideText());
    expect(resolveActiveToolIds([], []).has("loadUiGuide")).toBe(true);
  });

  it("is offered in every mode", async () => {
    for (const mode of ["chat", "ask", "agent", "plan"] as const) {
      const tools = await buildTools({
        activeToolIds: resolveActiveToolIds([], []), searchProvider: "duckduckgo", userId: "u", contextWindow: 8192, mode,
      });
      expect(tools).toHaveProperty("loadUiGuide");
    }
  });
});
