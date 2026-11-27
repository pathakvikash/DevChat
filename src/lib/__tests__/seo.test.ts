import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import nextConfig from "../../../next.config";
import { siteUrl } from "@/lib/site";

describe("seo", () => {
  it("robots allows the site, blocks the app and api, and links the sitemap", () => {
    const r = robots();
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rule.allow).toBe("/");
    expect(rule.disallow).toEqual(expect.arrayContaining(["/api/", "/settings/", "/c/", "/login$"]));
    expect(r.sitemap).toBe(new URL("/sitemap.xml", siteUrl()).href);
  });

  it("sitemap lists only the landing page", () => {
    expect(sitemap().map((e) => e.url)).toEqual([siteUrl().href]);
  });

  it("siteUrl prefers SITE_URL, then the Vercel host, then the deployed fallback", () => {
    expect(siteUrl({ SITE_URL: "https://orrery.example" }).origin).toBe("https://orrery.example");
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app" }).origin).toBe("https://x.vercel.app");
    expect(siteUrl({ NODE_ENV: "production" }).origin).toBe("https://dev-chat-beta.vercel.app");
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
