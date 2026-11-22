import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { listModels } from "@/lib/models";
import { PROVIDERS } from "@/lib/providers";

const DEFAULT_URL = "http://localhost:1234/v1";
const lm = PROVIDERS.find((p) => p.id === "lmstudio")!;
const defaultCreds = { lmstudio: { apiKey: "lm-studio", baseUrl: DEFAULT_URL } };

/** Ollama's probe answers empty; every other URL goes to `reply`. Returns the mock so calls can be checked. */
function stubFetch(reply: () => Promise<Response>) {
  const mock = vi.fn(async (url: string) => (String(url).includes("/api/tags") ? new Response("{}") : reply()));
  vi.stubGlobal("fetch", mock);
  return mock;
}

const lmCalls = (mock: ReturnType<typeof stubFetch>) => mock.mock.calls.filter(([u]) => String(u).startsWith(DEFAULT_URL));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("LM Studio when nothing is configured", () => {
  it("is quietly not configured when no server answers: no error, no warning", async () => {
    const mock = stubFetch(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:1234");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { models, status } = await listModels(defaultCreds);
    const entry = status.find((s) => s.id === "lmstudio");
    expect(entry).toEqual({ id: "lmstudio", label: "LM Studio", configured: false, modelCount: 0 });
    expect(models.some((m) => m.id.startsWith("lmstudio/"))).toBe(false);
    expect(lmCalls(mock).length).toBe(1);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("LM Studio"));
  });

  it("never fetches localhost on Vercel", async () => {
    vi.stubEnv("VERCEL", "1");
    const mock = stubFetch(async () => new Response("{}"));
    const { status } = await listModels(defaultCreds);
    expect(lmCalls(mock)).toEqual([]);
    expect(status.find((s) => s.id === "lmstudio")?.configured).toBe(false);
  });

  it("still reports an error when the user explicitly configured a URL", async () => {
    stubFetch(async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.5:1234");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { status } = await listModels({ lmstudio: { apiKey: "lm-studio", baseUrl: "http://gpu-box:1234/v1" } });
    expect(status.find((s) => s.id === "lmstudio")).toMatchObject({
      configured: true,
      error: "Could not reach this provider",
    });
  });

  it("lists chat models from a reachable default server and leaves out embeddings", async () => {
    stubFetch(async () =>
      new Response(
        JSON.stringify({
          data: [{ id: "qwen/qwen3.5-9b" }, { id: "text-embedding-nomic-embed-text-v1.5" }],
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    const { models, status } = await listModels(defaultCreds);
    expect(status.find((s) => s.id === "lmstudio")).toMatchObject({ configured: true, modelCount: 1 });
    expect(models.filter((m) => m.id.startsWith("lmstudio/")).map((m) => m.id)).toEqual(["lmstudio/qwen/qwen3.5-9b"]);
  });
});
