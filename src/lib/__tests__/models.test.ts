import { describe, it, expect, vi } from "vitest";
import { getModel } from "@/lib/models";
import { PROVIDERS } from "@/lib/providers";

const creds = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, { apiKey: "k", baseUrl: p.baseUrl ?? "http://localhost:1/v1" }]),
);

function modelOf(id: string) {
  return getModel(id, creds).model as { provider: string; specificationVersion: string };
}

describe("getModel routing", () => {
  it("sends OpenAI through the Responses API and Anthropic through Messages", () => {
    expect(modelOf("openai/gpt-5.6-sol").provider).toBe("openai.responses");
    expect(modelOf("anthropic/claude-sonnet-5-5").provider).toBe("anthropic.messages");
  });

  it("keeps the OpenAI-compatible chat path for every other provider", () => {
    for (const id of ["google/gemini-3.8-flash", "openrouter/meta/x:free", "nvidia-nim/a/b", "custom/m"]) {
      expect(modelOf(id).provider).toMatch(/\.chat$/);
    }
  });

  it("returns V3 language models on every path", () => {
    for (const p of PROVIDERS) expect(modelOf(`${p.id}/m`).specificationVersion).toBe("v3");
  });

  it.each([
    ["openai/gpt-5.6-sol", "openai", "https://api.openai.com/v1/responses"],
    ["anthropic/claude-opus-5-5", "anthropic", "http://proxy.test/v1/messages"],
  ])("%s calls the native endpoint under the creds base URL", async (id, provider, url) => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const { model } = getModel(id, { [provider]: { apiKey: "bogus", baseUrl: provider === "openai" ? "https://api.openai.com/v1" : "http://proxy.test/v1" } }) as any;
    await model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }).catch(() => {});
    vi.unstubAllGlobals();
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(url);
  });

  it("uses Chat Completions for OpenAI behind a custom base URL", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const { model } = getModel("openai/m", { openai: { apiKey: "k", baseUrl: "http://vllm.test/v1" } }) as any;
    expect(model.provider).toMatch(/\.chat$/);
    await model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }).catch(() => {});
    vi.unstubAllGlobals();
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe("http://vllm.test/v1/chat/completions");
  });

  it("never stores OpenAI Responses calls and sends history inline, not as item_reference", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const { model } = getModel("openai/gpt-5.6-sol", { openai: { apiKey: "k", baseUrl: "https://api.openai.com/v1" } }) as any;
    await model
      .doGenerate({
        prompt: [
          { role: "user", content: [{ type: "text", text: "hi" }] },
          { role: "assistant", content: [{ type: "text", text: "hello", providerOptions: { openai: { itemId: "msg_123" } } }] },
          { role: "user", content: [{ type: "text", text: "again" }] },
        ],
        providerOptions: { openai: { reasoningSummary: "detailed", reasoningEffort: "high" } },
      })
      .catch(() => {});
    vi.unstubAllGlobals();
    const body = JSON.parse(String(((fetchMock.mock.calls[0] as unknown[])[1] as RequestInit).body));
    expect(body.store).toBe(false);
    expect(JSON.stringify(body.input)).not.toContain("item_reference");
    expect(body.reasoning).toMatchObject({ effort: "high", summary: "detailed" }); // the reasoning options still merge in
  });

  it("ignores ANTHROPIC_BASE_URL and calls the resolved creds base URL", async () => {
    vi.stubEnv("ANTHROPIC_BASE_URL", "http://leak.test");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const { model } = getModel("anthropic/claude-opus-5-5", { anthropic: { apiKey: "k", baseUrl: "http://creds.test/v1" } }) as any;
    await model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }).catch(() => {});
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe("http://creds.test/v1/messages");
  });
});
