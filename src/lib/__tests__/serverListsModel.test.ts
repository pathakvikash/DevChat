import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The id cache is module state: each test gets a fresh module.
async function load() {
  vi.resetModules();
  return import("@/app/hooks/useModelsApi");
}
const answer = (ids: string[]) => ({ ok: true, json: async () => ({ models: ids.map((id) => ({ id })) }) }) as Response;

describe("serverListsModel", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn(async () => answer(["ollama/a"]));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("uses the cached answer within 60 s: one fetch for two calls", async () => {
    const { serverListsModel } = await load();
    expect(await serverListsModel("ollama/a")).toBe(true);
    expect(await serverListsModel("ollama/b")).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(59_000);
    expect(await serverListsModel("ollama/a")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refetches after the cache expires", async () => {
    const { serverListsModel } = await load();
    await serverListsModel("ollama/a");
    vi.advanceTimersByTime(61_000);
    fetchMock.mockImplementation(async () => answer(["ollama/b"]));
    expect(await serverListsModel("ollama/b")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("is null when the fetch fails (and does not cache the failure)", async () => {
    const { serverListsModel } = await load();
    fetchMock.mockImplementationOnce(async () => {
      throw new Error("offline");
    });
    expect(await serverListsModel("ollama/a")).toBeNull();
    expect(await serverListsModel("ollama/a")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("is null on a non-ok answer", async () => {
    const { serverListsModel } = await load();
    fetchMock.mockImplementationOnce(async () => ({ ok: false, json: async () => ({}) }) as Response);
    expect(await serverListsModel("ollama/a")).toBeNull();
  });
});
