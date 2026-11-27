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
    expect(shouldInlineUiGuide([user("make two charts")])).toBe(true);
    expect(shouldInlineUiGuide([user("compare these tables")])).toBe(true);
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

describe("honest replies", () => {
  const BASE = "You are an assistant inside Orrery";

  it("base prompt comes first with no user prompt, naming the real model", async () => {
    const r = await buildSystemPrompt(opts({ modelId: "gpt-test-9" }));
    expect(r.text.startsWith(BASE)).toBe(true);
    expect(r.text).toContain('"gpt-test-9"');
    expect(r.text).toContain("Never invent numbers, quotes, sources, URLs or results");
  });

  it("base prompt goes before the user's system prompt", async () => {
    const r = await buildSystemPrompt(opts({ systemPrompt: "Talk like a pirate", useTools: true, modelId: "m1" }));
    expect(r.text.startsWith(BASE)).toBe(true);
    expect(r.text.indexOf(BASE)).toBeLessThan(r.text.indexOf("Talk like a pirate"));
  });

  it("tool claims follow the request: none without tools", async () => {
    const none = (await buildSystemPrompt(opts())).text;
    expect(none).toContain("no tools in this request");
    expect(none).not.toContain("only the tools defined in this request");
    const some = (await buildSystemPrompt(opts({ useTools: true }))).text;
    expect(some).toContain("only the tools defined in this request");
    expect(some).not.toContain("no tools in this request");
  });

  it("non-tool models still get honesty lines with or without the inlined guide", async () => {
    for (const messages of [[user("hi")], [user("make a chart")]]) {
      const t = (await buildSystemPrompt(opts({ messages }))).text;
      expect(t).toContain("I can't check that");
    }
  });

  it("link clause: opens with fetchUrl when present, otherwise says it cannot open links", async () => {
    const withTool = (await buildSystemPrompt(opts({ useTools: true, activeToolIds: new Set(["fetchUrl"]) }))).text;
    expect(withTool).toContain("open it with fetchUrl before answering");
    expect(withTool).not.toContain("ask them to paste the content");
    const noTool = (await buildSystemPrompt(opts({ useTools: true, activeToolIds: new Set(["webSearch"]) }))).text;
    expect(noTool).toContain("no tool in this request can open it");
    expect(noTool).toContain("never describe a page from its URL or name");
    const chatOnly = (await buildSystemPrompt(opts())).text;
    expect(chatOnly).toContain("say you can't open links here and ask them to paste the content");
    expect(chatOnly).not.toContain("fetchUrl");
  });

  it("a default tool-model chat includes fetchUrl and the 'open it with fetchUrl' line", async () => {
    const active = resolveActiveToolIds([], []);
    expect(active.has("fetchUrl")).toBe(true);
    const t = (await buildSystemPrompt(opts({ useTools: true, activeToolIds: active }))).text;
    expect(t).toContain("open it with fetchUrl before answering");
  });

  it("persona wording says Orrery, not VAS", async () => {
    expect((await buildSystemPrompt(opts({ useTools: true }))).text).not.toContain("You are VAS");
    expect((await buildSystemPrompt(opts())).text).not.toContain("You are VAS");
  });

  it("sample-data rule is in the stub, the full guide and the artifact tool", () => {
    expect(GENERATIVE_UI_STUB).toContain("Sample data");
    expect(uiGuideText()).toContain("Sample data");
    expect(TOOL_REGISTRY.createArtifact.modelDescription).toContain("Sample data");
  });
});
