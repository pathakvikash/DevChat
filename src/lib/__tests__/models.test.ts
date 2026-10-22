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
    ["openai/gpt-5.6-sol", "openai", "http://proxy.test/v1/responses"],
    ["anthropic/claude-opus-5-5", "anthropic", "http://proxy.test/v1/messages"],
  ])("%s calls the native endpoint under the creds base URL", async (id, provider, url) => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const { model } = getModel(id, { [provider]: { apiKey: "bogus", baseUrl: "http://proxy.test/v1" } }) as any;
    await model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }).catch(() => {});
    vi.unstubAllGlobals();
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(url);
  });
});
