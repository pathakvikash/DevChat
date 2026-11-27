import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import nextConfig from "../../../next.config";
import { SITE_DESCRIPTION, siteUrl } from "@/lib/site";

describe("seo", () => {
  it("robots allows the site, blocks the app and api, and links the sitemap", () => {
    const r = robots();
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rule.allow).toBe("/");
    expect(rule.disallow).toEqual(expect.arrayContaining(["/api/", "/settings/", "/c/"]));
    // /login stays crawlable so a crawler can read its noindex.
    expect(rule.disallow).not.toContain("/login$");
    expect(rule.disallow).not.toContain("/login/");
    expect(r.sitemap).toBe(new URL("/sitemap.xml", siteUrl()!).href);
  });

  it("the site meta description is 140 to 160 characters", () => {
    expect(SITE_DESCRIPTION.length).toBeGreaterThanOrEqual(140);
    expect(SITE_DESCRIPTION.length).toBeLessThanOrEqual(160);
  });

  it("sitemap starts with the landing page (marketing pages: marketingPages.test.ts)", () => {
    expect(sitemap()[0].url).toBe(siteUrl()!.href);
  });

  it("siteUrl prefers SITE_URL, then the Vercel host, then localhost outside production", () => {
    expect(siteUrl({ SITE_URL: "https://orrery.example" })!.origin).toBe("https://orrery.example");
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app" })!.origin).toBe("https://x.vercel.app");
    expect(siteUrl({})!.origin).toBe("http://localhost:3000");
  });

  it("siteUrl is null in production with no address, or with a bad one", () => {
    expect(siteUrl({ NODE_ENV: "production" })).toBeNull();
    expect(siteUrl({ NODE_ENV: "production", SITE_URL: "not a url" })).toBeNull();
  });

  it("with no known address robots has no Sitemap line and the sitemap is empty", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    try {
      expect(robots().sitemap).toBeUndefined();
      expect(sitemap()).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // The login page and middleware pull in next-auth, which does not load under vitest, so these two read the source.
  it("the login page is noindex in its meta, matching the header", () => {
    expect(readFileSync("src/app/login/page.tsx", "utf8")).toContain("robots: { index: false, follow: false }");
  });

  it("the middleware matcher excludes only the exact public files and folders", () => {
    const src = readFileSync("src/middleware.ts", "utf8");
    const literal = /matcher: \[\s*(?:\/\/.*\s*)*"(.*)",\s*\]/.exec(src)![1];
    const re = new RegExp(`^${JSON.parse(`"${literal}"`)}$`);
    for (const p of ["/robots.txt", "/sitemap.xml", "/opengraph-image", "/twitter-image-1a2b3c", "/icon.svg", "/api/auth/session", "/login", "/_next/static/a.js"]) {
      expect(re.test(p), p).toBe(false);
    }
    for (const p of ["/", "/robotsxtxt", "/robots.txt.bak", "/loginx", "/login-help", "/api/authx", "/api/providers/pair/redeemer", "/icon-svg", "/opengraph-images", "/settings"]) {
      expect(re.test(p), p).toBe(true);
    }
  });

  it("private routes get X-Robots-Tag noindex, the landing page does not", async () => {
    const rules = await nextConfig.headers!();
    const noindex = rules.filter((r) => r.headers.some((h) => h.key === "X-Robots-Tag" && /noindex/.test(h.value)));
    expect(noindex).toHaveLength(1);
    const re = new RegExp(`^${noindex[0].source.replace("/:path*", "(/.*)?")}$`);
    for (const p of ["/settings", "/c/abc", "/workflows/x", "/artifacts", "/api/conversations", "/login"]) {
      expect(re.test(p), p).toBe(true);
    }
    for (const p of ["/", "/robots.txt", "/sitemap.xml"]) expect(re.test(p), p).toBe(false);
  });
});
