import { describe, it, expect, vi, beforeEach } from "vitest";

const safeFetch = vi.fn();
vi.mock("@/lib/net/safeFetch", () => ({ safeFetch: (...a: unknown[]) => safeFetch(...a), SafeFetchError: class extends Error {} }));

import { fetchCard } from "@/lib/workflows/cards/fetch";
import type { CardCtx } from "@/lib/workflows/cards";

const res = (over: Record<string, unknown> = {}) => ({ status: 200, ok: true, url: "https://a.test/final", contentType: "text/html", text: "", ...over });
const run = (config: Record<string, unknown>, extra: Partial<CardCtx["tctx"]> = {}, signal = new AbortController().signal) =>
  fetchCard.run({
    config: { url: "https://a.test/x", as: "page", ...config },
    tctx: { nodes: {}, vars: {}, run: { id: "r", date: "2026-11-09", startedAt: "" }, workflow: { name: "W" }, ...extra },
    signal,
  } as unknown as CardCtx);

beforeEach(() => {
  safeFetch.mockReset();
});

describe("the fetch card and GitHub", () => {
  it("in sanity mode never touches the network or the token for api.github.com", async () => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_secret");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("SANITY_TEST_AUTH", "1");
    vi.stubEnv("DATABASE_URL", "file:./sanity.db");
    try {
      const r = await run({ url: "https://api.github.com/repos/o/r", as: "json" });
      expect(r.output).toHaveProperty("data");
      expect(safeFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("sends the token only after the repo is confirmed public, and words a rate limit from what was sent", async () => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_secret");
    try {
      safeFetch.mockResolvedValueOnce(res({ text: '{"private":false}' })).mockResolvedValueOnce(res({ status: 403, ok: false, text: '{"message":"API rate limit exceeded"}' }));
      await expect(run({ url: "https://api.github.com/repos/o/r/readme", as: "json" })).rejects.toThrow(/GITHUB_TOKEN's hourly limit/);
      expect(safeFetch.mock.calls[1][1].headers.Authorization).toBe("Bearer ghp_secret");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("the fetch card", () => {
  it("page: readable text, scripts and tags gone, cut at 8,000 characters with a warning", async () => {
    safeFetch.mockResolvedValue(res({ text: "<html><script>evil()</script><body><h1>Hi</h1><p>there &amp; you</p></body></html>" }));
    const r = await run({});
    expect(r.output).toEqual({ url: "https://a.test/final", text: "Hi there & you" });
    safeFetch.mockResolvedValue(res({ text: `<p>${"x".repeat(9000)}</p>` }));
    const long = await run({});
    expect((long.output as { text: string }).text).toHaveLength(8000);
    expect(long.warnings?.join()).toContain("cut to 8,000");
  });

  it("feed: items with title, url, date and summary", async () => {
    safeFetch.mockResolvedValue(res({ contentType: "application/rss+xml", text: "<rss><channel><title>T</title><item><title>One</title><link>https://a.test/1</link></item></channel></rss>" }));
    const r = await run({ as: "feed" });
    expect(r.output).toMatchObject({ title: "T", count: 1, items: [{ title: "One", url: "https://a.test/1" }] });
  });

  it("json: the parsed data, and a clear error when it is not JSON", async () => {
    safeFetch.mockResolvedValue(res({ contentType: "application/json", text: '{"a":[1,2]}' }));
    expect((await run({ as: "json" })).output).toEqual({ url: "https://a.test/final", data: { a: [1, 2] } });
    safeFetch.mockResolvedValue(res({ text: "<html>" }));
    await expect(run({ as: "json" })).rejects.toThrow("not valid JSON");
  });

  it("page: plain text keeps its newlines and <Tags>; the HTTP error carries GitHub's own message", async () => {
    safeFetch.mockResolvedValue(res({ contentType: "text/plain", text: "a\nconst x = <T,>() => <div/>;" }));
    expect((await run({})).output).toEqual({ url: "https://a.test/final", text: "a\nconst x = <T,>() => <div/>;" });
    safeFetch.mockResolvedValue(res({ status: 403, ok: false, contentType: "application/json", text: '{"message":"API rate limit exceeded for 1.2.3.4."}' }));
    await expect(run({})).rejects.toThrow("HTTP 403: API rate limit exceeded for 1.2.3.4. for https://a.test/x");
  });

  it("fails on a feed it cannot read, an HTTP error and an empty URL", async () => {
    safeFetch.mockResolvedValue(res({ text: "<html>nope</html>" }));
    await expect(run({ as: "feed" })).rejects.toThrow(/RSS or Atom/);
    safeFetch.mockResolvedValue(res({ status: 404, ok: false }));
    await expect(run({})).rejects.toThrow("HTTP 404 for https://a.test/x");
    await expect(run({ url: "{{item.url}}" })).rejects.toThrow("no URL");
  });

  it("renders the URL from the current item", async () => {
    safeFetch.mockResolvedValue(res({ text: "ok" }));
    await run({ url: "{{item.url}}" }, { item: { url: "https://b.test/y" }, index: 1 });
    expect(safeFetch.mock.calls[0][0]).toBe("https://b.test/y");
  });

  it("goes through safeFetch only, and passes a blocked-URL error on as it is", async () => {
    safeFetch.mockImplementation(async () => {
      throw new Error("That address is private and cannot be fetched");
    });
    await expect(run({ url: "http://169.254.169.254/" })).rejects.toThrow("private");
    expect(safeFetch).toHaveBeenCalledTimes(1);
  });

  it("retries once after a 503, then gives up with the HTTP error", async () => {
    vi.useFakeTimers();
    try {
      safeFetch.mockResolvedValueOnce(res({ status: 503, ok: false })).mockResolvedValueOnce(res({ text: "back up" }));
      const p = run({});
      await vi.advanceTimersByTimeAsync(2100);
      expect((await p).output).toMatchObject({ text: "back up" });
      expect(safeFetch).toHaveBeenCalledTimes(2);

      safeFetch.mockReset();
      safeFetch.mockResolvedValue(res({ status: 500, ok: false }));
      const q = run({});
      const failed = expect(q).rejects.toThrow("HTTP 500");
      await vi.advanceTimersByTimeAsync(2100);
      await failed;
      expect(safeFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs 3 at a time", () => {
    expect(fetchCard.concurrency?.({} as CardCtx)).toBe(3);
  });
});
