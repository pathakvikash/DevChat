import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const safeFetch = vi.fn();
vi.mock("@/lib/net/safeFetch", () => ({ safeFetch: (...a: unknown[]) => safeFetch(...a) }));

import { githubAuthHeaders, githubRateLimitHint } from "@/lib/net/github";

const API = "https://api.github.com/repos/o/r";
const repoRes = (body: unknown, status = 200) => ({ status, ok: status === 200, url: API, contentType: "application/json", text: typeof body === "string" ? body : JSON.stringify(body) });
let n = 0;
// A fresh repo name per test, so the module-level verdict cache never leaks between tests.
const fresh = () => `https://api.github.com/repos/o/r${++n}`;

beforeEach(() => {
  safeFetch.mockReset();
  process.env.GITHUB_TOKEN = " ghp_secret ";
});
afterEach(() => {
  delete process.env.GITHUB_TOKEN;
});

describe("githubAuthHeaders", () => {
  it("gives {} without a token, and never asks GitHub", async () => {
    delete process.env.GITHUB_TOKEN;
    expect(await githubAuthHeaders(fresh())).toEqual({});
    process.env.GITHUB_TOKEN = "   ";
    expect(await githubAuthHeaders(fresh())).toEqual({});
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it.each([
    "https://example.test/repos/o/r",
    "http://api.github.com/repos/o/r",
    "https://api.github.com:8443/repos/o/r",
    "https://user@api.github.com/repos/o/r",
    "https://api.github.com.evil.test/repos/o/r",
    "https://evil.test/api.github.com/repos/o/r",
    "https://api.github.com/user",
    "https://api.github.com/search/repositories?q=x",
    "https://api.github.com/repos/o",
    "not a url",
  ])("gives {} for %s without any request", async (url) => {
    expect(await githubAuthHeaders(url)).toEqual({});
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("sends the trimmed token for a public repo, and caches the verdict", async () => {
    safeFetch.mockResolvedValue(repoRes({ private: false, visibility: "public" }));
    const url = fresh();
    expect(await githubAuthHeaders(url)).toEqual({ Authorization: "Bearer ghp_secret" });
    expect(await githubAuthHeaders(`${url}/git/trees/main?recursive=1`)).toEqual({ Authorization: "Bearer ghp_secret" });
    expect(await githubAuthHeaders(url.toUpperCase().replace("HTTPS://API.GITHUB.COM/REPOS", "https://api.github.com/repos"))).toEqual({ Authorization: "Bearer ghp_secret" });
    expect(safeFetch).toHaveBeenCalledTimes(1);
  });

  it("gives {} for a private repo, and caches that too", async () => {
    safeFetch.mockResolvedValue(repoRes({ private: true, visibility: "private" }));
    const url = fresh();
    expect(await githubAuthHeaders(url)).toEqual({});
    expect(await githubAuthHeaders(url)).toEqual({});
    expect(safeFetch).toHaveBeenCalledTimes(1);
  });

  it("gives {} unless private is false and visibility, when present, is public", async () => {
    for (const body of [{ visibility: "public" }, { private: false, visibility: "internal" }, { private: "false" }, null]) {
      safeFetch.mockResolvedValue(repoRes(body ?? "null"));
      expect(await githubAuthHeaders(fresh())).toEqual({});
    }
  });

  it("gives {} when the check throws, returns 404, or returns bad JSON", async () => {
    safeFetch.mockRejectedValueOnce(new Error("boom ghp_secret"));
    expect(await githubAuthHeaders(fresh())).toEqual({});
    safeFetch.mockResolvedValueOnce(repoRes({ message: "Not Found" }, 404));
    expect(await githubAuthHeaders(fresh())).toEqual({});
    safeFetch.mockResolvedValueOnce(repoRes("<html>"));
    expect(await githubAuthHeaders(fresh())).toEqual({});
  });

  it("makes the check itself with the token against the repo root", async () => {
    safeFetch.mockResolvedValue(repoRes({ private: false }));
    await githubAuthHeaders(`${fresh()}/contents/x`);
    const [url, opts] = safeFetch.mock.calls[0];
    expect(url).toBe(`https://api.github.com/repos/o/r${n}`);
    expect(opts.headers.Authorization).toBe("Bearer ghp_secret");
  });
});

describe("githubRateLimitHint", () => {
  it("points at GITHUB_TOKEN when none is set", () => {
    delete process.env.GITHUB_TOKEN;
    expect(githubRateLimitHint(403, API, "API rate limit exceeded for 1.2.3.4")).toMatch(/set GITHUB_TOKEN/);
    expect(githubRateLimitHint(429, API, "secondary Rate Limit")).toMatch(/set GITHUB_TOKEN/);
  });

  it("says the token's limit is used up when one is set", () => {
    const h = githubRateLimitHint(403, API, "API rate limit exceeded");
    expect(h).toMatch(/GITHUB_TOKEN's hourly limit/);
    expect(h).not.toMatch(/ghp_secret/);
  });

  it("stays empty for other statuses, hosts and messages", () => {
    expect(githubRateLimitHint(404, API, "rate limit")).toBe("");
    expect(githubRateLimitHint(403, "https://example.test/x", "rate limit")).toBe("");
    expect(githubRateLimitHint(403, API, "Forbidden")).toBe("");
    expect(githubRateLimitHint(403, "nope", "rate limit")).toBe("");
  });
});
