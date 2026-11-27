import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MarketingPageView from "@/app/components/marketing/MarketingPage";
import sitemap from "@/app/sitemap";
import { MARKETING_PAGES, MARKETING_PATHS, pagePath } from "@/lib/marketing/pages";
import { PRIVATE_SEGMENTS, isPublicPath, siteUrl } from "@/lib/site";
import nextConfig from "../../../next.config";

const unique = (xs: string[]) => new Set(xs).size === xs.length;

describe("marketing pages data", () => {
  it("has the seven pages, each with a unique path, title and description", () => {
    expect(MARKETING_PAGES).toHaveLength(7);
    expect(unique(MARKETING_PATHS.slice())).toBe(true);
    expect(unique(MARKETING_PAGES.map((p) => p.title))).toBe(true);
    expect(unique(MARKETING_PAGES.map((p) => p.description))).toBe(true);
  });

  for (const page of MARKETING_PAGES) {
    describe(pagePath(page), () => {
      it("has a short title and a 140-160 character description", () => {
        expect(page.title.length).toBeLessThan(60);
        expect(page.description.length).toBeGreaterThanOrEqual(140);
        expect(page.description.length).toBeLessThanOrEqual(160);
      });

      it("has sections, 3-4 FAQ items and 2-3 related pages that exist", () => {
        expect(page.sections.length).toBeGreaterThan(0);
        for (const s of page.sections) expect(s.bullets.length).toBeGreaterThan(0);
        expect(page.faq.length).toBeGreaterThanOrEqual(3);
        expect(page.faq.length).toBeLessThanOrEqual(4);
        expect(page.related.length).toBeGreaterThanOrEqual(2);
        expect(page.related.length).toBeLessThanOrEqual(3);
        for (const r of page.related) expect(MARKETING_PATHS).toContain(r);
        expect(page.related).not.toContain(pagePath(page));
      });

      it("renders one h1, a breadcrumb, the sign-in link and escaped JSON-LD", () => {
        const html = renderToStaticMarkup(createElement(MarketingPageView, { page }));
        expect(html.match(/<h1[ >]/g)).toHaveLength(1);
        expect(html).toContain('aria-label="Breadcrumb"');
        expect(html).toContain('href="/login"');
        const ld = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1];
        expect(ld).not.toContain("<");
        const graph = JSON.parse(ld)["@graph"];
        expect(graph.map((n: { "@type": string }) => n["@type"])).toEqual(["BreadcrumbList", "FAQPage"]);
        expect(graph[1].mainEntity).toHaveLength(page.faq.length);
      });

      it("has a real screenshot on disk under 150 KB, with alt text, rendered with explicit size", () => {
        const { src, alt, width, height } = page.screenshot;
        expect(src).toBe(`/marketing/${page.slug}.webp`);
        const file = path.join(process.cwd(), "public", src);
        expect(fs.existsSync(file), file).toBe(true);
        expect(fs.statSync(file).size).toBeLessThan(150 * 1024);
        expect(alt.length).toBeGreaterThan(30);
        expect(alt).not.toMatch(/mock|test|sanity|e2e/i);
        const html = renderToStaticMarkup(createElement(MarketingPageView, { page }));
        expect(html).toContain(`src="${src}"`);
        expect(html).toContain(`width="${width}"`);
        expect(html).toContain(`height="${height}"`);
        expect(html).toContain('loading="lazy"');
      });

      it("is in the sitemap and open to signed-out visitors, with its share images", () => {
        expect(sitemap().map((e) => e.url)).toContain(new URL(pagePath(page), siteUrl()!).href);
        expect(isPublicPath(pagePath(page))).toBe(true);
        expect(isPublicPath(`${pagePath(page)}/opengraph-image`)).toBe(true);
        expect(isPublicPath(`${pagePath(page)}/twitter-image`)).toBe(true);
      });
    });
  }

  it("opens nothing else to signed-out visitors", () => {
    for (const p of [
      "/features/../settings",
      "/featuresX",
      "/features",
      "/features/",
      "/features/unknown",
      "/features/agents/extra",
      "/features/agents/",
      "/use-cases/study/settings",
      "/settings",
      "/api/conversations",
      "/c/abc",
    ]) {
      expect(isPublicPath(p), p).toBe(false);
    }
    expect(isPublicPath("/")).toBe(true);
    expect(isPublicPath("/welcome")).toBe(true);
    expect(isPublicPath("/settings/opengraph-image")).toBe(false);
    expect(isPublicPath("/features/agents/opengraph-image-1a2b")).toBe(true);
  });

  it("the middleware lets signed-out visitors fetch /marketing/ images", async () => {
    // The middleware module needs next-auth at import time, so read the matcher out of the source.
    const src = fs.readFileSync(path.join(process.cwd(), "src/middleware.ts"), "utf8");
    const literal = /matcher: \[\s*(?:\/\/[^\n]*\n\s*)*"((?:[^"\\]|\\.)*)"/.exec(src)![1];
    const re = new RegExp(`^${JSON.parse(`"${literal}"`)}$`);
    expect(re.test("/marketing/agents.webp")).toBe(false); // not matched, so not sent to login
    expect(re.test("/settings")).toBe(true);
    expect(re.test("/marketingx")).toBe(true);
  });

  it("is not covered by robots.txt or the noindex header", async () => {
    const rules = await nextConfig.headers!();
    const noindex = rules.filter((r) => r.headers.some((h) => h.key === "X-Robots-Tag" && /noindex/.test(h.value)));
    const re = new RegExp(`^${noindex[0].source.replace("/:path*", "(/.*)?")}$`);
    for (const p of MARKETING_PATHS) expect(re.test(p), p).toBe(false);
    expect(PRIVATE_SEGMENTS).not.toContain("features");
    expect(PRIVATE_SEGMENTS).not.toContain("use-cases");
  });
});
