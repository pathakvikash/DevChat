import { readFile } from "node:fs/promises";
import path from "node:path";
import { isSanityMode } from "@/lib/sanityMode";
import { safeFetch, type SafeFetchResult } from "@/lib/net/safeFetch";
import { htmlToText } from "@/lib/net/htmlText";
import { parseFeed } from "../feed";
import { renderText } from "../template";
import { sleep } from "./webSearch";
import type { CardImpl } from "./index";

const PAGE_CHARS = 8000;
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; VAS/1.0; +https://github.com/anthropics/claude-code)",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml,application/atom+xml,application/json;q=0.8,*/*;q=0.7",
};

/** GET through safeFetch (DNS check, private ranges, redirects by hand, 2 MB cap). One retry after 2 s on a 429 or 5xx. */
async function get(url: string, signal: AbortSignal): Promise<SafeFetchResult> {
  // Sanity mode reads recorded answers for the GitHub API: no network and no rate limit.
  if (isSanityMode() && new URL(url).hostname === "api.github.com") {
    const file = path.join(process.cwd(), "e2e/fixtures/workflows", url.includes("/git/trees/") ? "repo-tree.json" : "repo-info.json");
    return { status: 200, ok: true, url, contentType: "application/json", text: await readFile(file, "utf8") };
  }
  let res = await safeFetch(url, { headers: HEADERS, signal });
  if (res.status === 429 || res.status >= 500) {
    await sleep(2000, signal);
    if (signal.aborted) throw new Error("Cancelled");
    res = await safeFetch(url, { headers: HEADERS, signal });
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res;
}

export const fetchCard: CardImpl = {
  // Fetch runs 3 at a time.
  concurrency: () => 3,
  async run(c) {
    const rendered = renderText(String(c.config.url ?? ""), c.tctx);
    const url = rendered.text.trim();
    if (!url) throw new Error("There is no URL to fetch");
    const warnings = rendered.missing.slice(0, 10).map((m) => `{{${m}}} was empty`);
    const res = await get(url, c.signal);

    if (c.config.as === "feed") {
      const feed = parseFeed(res.text);
      return { output: { url: res.url, title: feed.title, items: feed.items, count: feed.items.length }, warnings };
    }
    if (c.config.as === "json") {
      let data: unknown;
      try {
        data = JSON.parse(res.text);
      } catch {
        throw new Error("The response is not valid JSON");
      }
      return { output: { url: res.url, data }, warnings };
    }
    const text = res.contentType.includes("json") ? res.text : htmlToText(res.text);
    if (text.length > PAGE_CHARS) warnings.push(`The page text was cut to ${PAGE_CHARS.toLocaleString("en-US")} characters`);
    return { output: { url: res.url, text: text.slice(0, PAGE_CHARS) }, warnings };
  },
};
