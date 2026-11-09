import { readFile } from "node:fs/promises";
import path from "node:path";
import { webSearch, type SearchProvider, type SearchResult } from "@/lib/search";
import { getSettingsKey } from "@/lib/settings";
import { isSanityMode } from "@/lib/sanityMode";
import { renderText } from "../template";
import type { CardImpl } from "./index";

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/** Sanity mode reads recorded results: no network and no search key. */
async function fixtureResults(): Promise<SearchResult[]> {
  const file = path.join(process.cwd(), "e2e/fixtures/workflows/search.json");
  return JSON.parse(await readFile(file, "utf8")).results;
}

export const webSearchCard: CardImpl = {
  async run(c) {
    const queries = renderText(String(c.config.queries ?? ""), c.tctx).text
      .split("\n")
      .map((q) => q.trim())
      .filter(Boolean);
    if (queries.length === 0) throw new Error("There is nothing to search for");
    const setting = c.config.provider || (await getSettingsKey(c.userId, "searchProvider"));
    const provider: SearchProvider = setting === "tavily" ? "tavily" : "duckduckgo";

    const seen = new Set<string>();
    const items: { title: string; url: string; snippet: string; query: string }[] = [];
    const warnings: string[] = [];
    let failed = 0;
    for (const [i, query] of queries.entries()) {
      if (c.signal.aborted) throw new Error("Cancelled");
      // DuckDuckGo gets one query at a time, a second apart.
      if (i > 0 && !isSanityMode()) await sleep(1000, c.signal);
      const found = isSanityMode() ? { results: await fixtureResults() } : await webSearch(query, provider);
      const warning = "warning" in found ? found.warning : undefined;
      if (warning) warnings.push(`${query}: ${warning}`);
      if (found.results.length === 0 && warning) failed++;
      for (const r of found.results) {
        if (seen.has(r.url)) continue;
        seen.add(r.url);
        items.push({ title: r.title, url: r.url, snippet: r.snippet, query });
      }
    }
    if (failed === queries.length) throw new Error(warnings[0] ?? "Every search failed");
    return { output: { items, count: items.length }, warnings };
  },
};
