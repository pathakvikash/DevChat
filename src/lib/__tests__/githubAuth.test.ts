import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const safeFetch = vi.fn();
vi.mock("@/lib/net/safeFetch", () => ({ safeFetch: (...a: unknown[]) => safeFetch(...a) }));

import { githubAuthHeaders, httpErrorText } from "@/lib/net/github";

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
    "https://api.github.com/repos/o/r/actions/variables",
    "https://api.github.com/repos/o/r/hooks",
    "https://api.github.com/repos/o/r/collaborators",
    "https://api.github.com/repos/o/r/contentsx",
    "not a url",
  ])("gives {} for %s without any request", async (url) => {
    expect(await githubAuthHeaders(url)).toEqual({});
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("sends the trimmed token for the explainer paths of a public repo", async () => {
    safeFetch.mockResolvedValue(repoRes({ private: false, visibility: "public" }));
    const url = fresh();
    for (const p of ["", "/git/trees/main?recursive=1", "/contents", "/contents/src/a.ts", "/readme", "/readme/docs"]) {
      expect(await githubAuthHeaders(url + p)).toEqual({ Authorization: "Bearer ghp_secret" });
    }
  });

  it("checks visibility on every call, so a repo turned private is not served from memory", async () => {
    const url = fresh();
    safeFetch.mockResolvedValueOnce(repoRes({ private: false })).mockResolvedValueOnce(repoRes({ private: true }));
    expect(await githubAuthHeaders(url)).toEqual({ Authorization: "Bearer ghp_secret" });
    expect(await githubAuthHeaders(url)).toEqual({});
    expect(safeFetch).toHaveBeenCalledTimes(2);
  });

  it("gives {} for a private repo", async () => {
    safeFetch.mockResolvedValue(repoRes({ private: true, visibility: "private" }));
    expect(await githubAuthHeaders(fresh())).toEqual({});
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

describe("httpErrorText", () => {
  const body = JSON.stringify({ message: "API rate limit exceeded for 1.2.3.4" });

  it("points at GITHUB_TOKEN when none is set", () => {
    delete process.env.GITHUB_TOKEN;
    expect(httpErrorText(403, API, body, false)).toMatch(/^HTTP 403: API rate limit exceeded.*set GITHUB_TOKEN.* for https:/);
    expect(httpErrorText(429, API, JSON.stringify({ message: "secondary Rate Limit" }), false)).toMatch(/set GITHUB_TOKEN/);
  });

  it("says the token's limit is used up when the request carried it", () => {
    const t = httpErrorText(403, API, body, true);
    expect(t).toMatch(/GITHUB_TOKEN's hourly limit/);
    expect(t).not.toMatch(/ghp_secret/);
  });

  it("adds no hint when the token is set but was not used for this request", () => {
    expect(httpErrorText(403, API, body, false)).toBe(`HTTP 403: API rate limit exceeded for 1.2.3.4 for ${API}`);
  });

  it("keeps the message for any host, hints only for GitHub rate limits", () => {
    delete process.env.GITHUB_TOKEN;
    expect(httpErrorText(404, "https://a.test/x", JSON.stringify({ message: "Not Found" }), false)).toBe("HTTP 404: Not Found for https://a.test/x");
    expect(httpErrorText(403, "https://a.test/x", body, false)).not.toMatch(/GITHUB_TOKEN/);
    expect(httpErrorText(404, API, body, false)).not.toMatch(/GITHUB_TOKEN/);
    expect(httpErrorText(500, API, "<html>", false)).toBe(`HTTP 500 for ${API}`);
  });
});
