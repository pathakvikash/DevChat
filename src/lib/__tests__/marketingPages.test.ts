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

      it("is in the sitemap and open to signed-out visitors, with its share images", () => {
        expect(sitemap().map((e) => e.url)).toContain(new URL(pagePath(page), siteUrl()).href);
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
