import { afterEach, describe, expect, it, vi } from "vitest";
import { pickDefaultModel, PREFERRED_MODEL_ID, rankDefaultModels } from "@/lib/defaultModel";
import { createConversation, MODEL_NOTE_KEY, shouldNoteModel, takeModelNote } from "@/app/hooks/useConversationsApi";

const m = (id: string, disabledReason?: string) => ({ id, disabledReason });
const OPENROUTER_HAIKU = "openrouter/anthropic/claude-haiku-5.5";

describe("pickDefaultModel", () => {
  it("1. keeps the saved default when it is listed", () => {
    const list = [m("openai/gpt-x"), m(PREFERRED_MODEL_ID), m("openrouter/a/b:free")];
    expect(pickDefaultModel("openrouter/a/b:free", list)).toEqual({ id: "openrouter/a/b:free", replaced: null, auto: false });
  });

  it("2. otherwise prefers Haiku 5.5 from Anthropic, then from OpenRouter, when listed", () => {
    const gone = "openrouter/some-lab/ling-flash:free";
    expect(PREFERRED_MODEL_ID).toBe("anthropic/claude-haiku-5-5");
    expect(pickDefaultModel(gone, [m("openai/gpt-x"), m(OPENROUTER_HAIKU), m(PREFERRED_MODEL_ID)])).toMatchObject({ id: PREFERRED_MODEL_ID, replaced: gone });
    expect(pickDefaultModel(gone, [m("openai/gpt-x"), m(OPENROUTER_HAIKU)])).toMatchObject({ id: OPENROUTER_HAIKU, replaced: gone });
    // Nothing saved: Haiku is still the choice, and there is nothing to say was replaced.
    expect(pickDefaultModel(null, [m("openai/gpt-x"), m(PREFERRED_MODEL_ID)])).toEqual({ id: PREFERRED_MODEL_ID, name: undefined, replaced: null, auto: true });
  });

  it("2b. without Haiku on Anthropic: a local or free model (tools first) beats OpenRouter Haiku and any other", () => {
    const local = (id: string, supportsTools?: boolean) => ({ id, supportsTools });
    const list = [m("openai/gpt-x"), m(OPENROUTER_HAIKU), local("ollama/a", false), local("ollama/b", true)];
    expect(pickDefaultModel(null, list).id).toBe("ollama/b");
    expect(pickDefaultModel(null, [m("openai/gpt-x"), m("lmstudio/q")]).id).toBe("lmstudio/q");
    expect(pickDefaultModel(null, [m("openai/gpt-x"), m(PREFERRED_MODEL_ID), m("ollama/b")]).id).toBe(PREFERRED_MODEL_ID);
    // A saved default that is listed still wins over all of it, and is not "auto".
    expect(pickDefaultModel("openai/gpt-x", list)).toEqual({ id: "openai/gpt-x", replaced: null, auto: false });
  });

  it("ranks: saved, Haiku (Anthropic), local, Haiku (OpenRouter), free with tools, then the rest", () => {
    const list = [
      m("openai/gpt-x"),
      { id: "openrouter/a/notools:free", supportsTools: false },
      { id: "openrouter/a/tools:free", supportsTools: true },
      m(OPENROUTER_HAIKU),
      m("ollama/l"),
      m(PREFERRED_MODEL_ID),
      m("openai/saved"),
    ];
    const ids = (saved: string | null) => rankDefaultModels(saved, list, false).map((x) => x.id);
    expect(ids("openai/saved")).toEqual(["openai/saved", PREFERRED_MODEL_ID, "ollama/l", OPENROUTER_HAIKU, "openrouter/a/tools:free", "openai/gpt-x", "openrouter/a/notools:free"]);
    expect(ids(null).slice(0, 2)).toEqual([PREFERRED_MODEL_ID, "ollama/l"]);
    // Only OpenRouter listed: Haiku, not the arbitrary first free model.
    expect(pickDefaultModel(null, [{ id: "openrouter/a/tools:free", supportsTools: true }, m(OPENROUTER_HAIKU)]).id).toBe(OPENROUTER_HAIKU);
    expect(pickDefaultModel(null, [m("openai/gpt-x"), { id: "openrouter/a/b:free", supportsTools: true }]).id).toBe("openrouter/a/b:free");
  });

  it("on the server path a saved bridge model that the server does not list is not used", () => {
    const list = [m("openai/gpt-x")];
    for (const saved of ["ollama/llama3.2:3b", "claude-code/default"]) {
      expect(pickDefaultModel(saved, list, false)).toMatchObject({ id: "openai/gpt-x", replaced: saved, auto: true });
      expect(pickDefaultModel(saved, list).id).toBe(saved); // the picker still keeps it
    }
  });

  it("3. otherwise the first usable listed model, and never an id that is not listed", () => {
    const gone = "openrouter/some-lab/ling-flash:free";
    expect(pickDefaultModel(gone, [m("x/disabled", "offline"), m("openai/gpt-x"), m("openai/gpt-y")])).toMatchObject({ id: "openai/gpt-x", replaced: gone });
    // A model that sounds like Haiku but is not exactly the preferred id does not count.
    expect(pickDefaultModel(gone, [m("anthropic/claude-haiku-4-5"), m("openai/gpt-x")]).id).toBe("anthropic/claude-haiku-4-5");
    // Haiku disabled: skipped.
    expect(pickDefaultModel(gone, [m(PREFERRED_MODEL_ID, "no key"), m("openai/gpt-x")]).id).toBe("openai/gpt-x");
  });

  it("leaves the saved value alone when nothing is listed, and keeps a saved bridge model", () => {
    expect(pickDefaultModel("openai/gpt-x", [])).toEqual({ id: "openai/gpt-x", replaced: null, auto: false });
    expect(pickDefaultModel(null, [])).toEqual({ id: undefined, replaced: null, auto: false });
    expect(pickDefaultModel("claude-code/default", [m("openai/gpt-x")])).toEqual({ id: "claude-code/default", replaced: null, auto: false });
    expect(pickDefaultModel("ollama/llama3.2:3b", [m("openai/gpt-x")])).toEqual({ id: "ollama/llama3.2:3b", replaced: null, auto: false });
  });
});

describe("takeModelNote", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("says which model replaced the default, once", () => {
    const store = new Map<string, string>([[`${MODEL_NOTE_KEY}c1`, JSON.stringify({ from: "openrouter/lab/ling-flash:free", to: "anthropic/claude-haiku-5-5" })]]);
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => store.get(k) ?? null, removeItem: (k: string) => store.delete(k) });
    expect(takeModelNote("c1")).toBe("Your default model ling-flash:free is not available any more, so this chat uses claude-haiku-5-5. You can change it in Settings.");
    expect(takeModelNote("c1")).toBeNull();
  });

  it("names the automatically picked model when nothing was saved", () => {
    const store = new Map<string, string>([[`${MODEL_NOTE_KEY}c2`, JSON.stringify({ from: null, to: "anthropic/claude-haiku-5-5", name: "Claude Haiku 5.5" })]]);
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => store.get(k) ?? null, removeItem: (k: string) => store.delete(k) });
    expect(takeModelNote("c2")).toBe("Using Claude Haiku 5.5. Change it in the model picker or set a default in Settings.");
  });
});

describe("shouldNoteModel", () => {
  it("notes an auto-picked model once, and again only when it changes", () => {
    expect(shouldNoteModel({ from: null, to: "a/x" }, null)).toBe(true);
    expect(shouldNoteModel({ from: null, to: "a/x" }, "a/x")).toBe(false);
    expect(shouldNoteModel({ from: null, to: "a/y" }, "a/x")).toBe(true);
  });

  it("always notes a saved default that is no longer available", () => {
    expect(shouldNoteModel({ from: "o/gone", to: "a/x" }, "a/x")).toBe(true);
  });
});

describe("createConversation model note", () => {
  it("stores the note even when localStorage cannot be read", async () => {
    const session = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    vi.stubGlobal("sessionStorage", { setItem: (k: string, v: string) => session.set(k, v) });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ id: "c9", modelReplaced: { from: null, to: "a/x" } }) })));
    await createConversation();
    expect(session.get(`${MODEL_NOTE_KEY}c9`)).toContain("a/x");
  });
});
