export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type SearchProvider = "tavily" | "duckduckgo";

/**
 * Tavily — high quality, requires TAVILY_API_KEY (free tier 1000/mo).
 */
async function tavilySearch(query: string): Promise<SearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY not set");

  const response = await fetch("https://api.tavily.com/search", {
    signal: AbortSignal.timeout(15000),
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: 5,
      include_answer: true,
    }),
  });
  if (!response.ok) {
    throw new Error(`Tavily API ${response.status}: ${response.statusText}`);
  }
  const data = (await response.json()) as any;
  return (data.results || []).map((r: any) => ({
    title: r.title,
    url: r.url,
    snippet: r.snippet || r.content || "",
  }));
}

const DDG_BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * DuckDuckGo HTML — free, no API key. Scrapes the HTML endpoint.
 * Fragile to layout changes but reasonable for personal use.
 */
async function duckDuckGoSearch(query: string): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: {
      "User-Agent": DDG_BROWSER_UA,
      Accept: "text/html",
    },
  });
  if (!response.ok) {
    throw new Error(`DuckDuckGo HTTP ${response.status}`);
  }
  const html = await response.text();

  const results: SearchResult[] = [];
  const blockRe =
    /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) !== null && results.length < 5) {
    const realUrl = extractDdgRedirect(m[1]);
    const title = stripTags(m[2]).trim();
    const snippet = stripTags(m[3]).trim();
    if (realUrl && title) results.push({ title, url: realUrl, snippet });
  }
  return results;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

function extractDdgRedirect(href: string): string | null {
  try {
    const absolute = href.startsWith("http")
      ? new URL(href)
      : new URL(href, "https://duckduckgo.com");
    const uddg = absolute.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    return absolute.toString();
  } catch {
    return null;
  }
}

/**
 * Dispatch: try the requested provider; if Tavily fails, fall back to DDG.
 */
export async function webSearch(
  query: string,
  provider: SearchProvider = "duckduckgo"
): Promise<{
  results: SearchResult[];
  usedProvider: SearchProvider;
  warning?: string;
}> {
  if (provider === "tavily") {
    try {
      const results = await tavilySearch(query);
      return { results, usedProvider: "tavily" };
    } catch (err) {
      const warning = `Tavily failed (${(err as Error).message}); falling back to DuckDuckGo.`;
      console.warn(warning);
      const results = await duckDuckGoSearch(query).catch(() => []);
      return { results, usedProvider: "duckduckgo", warning };
    }
  }
  try {
    const results = await duckDuckGoSearch(query);
    return { results, usedProvider: "duckduckgo" };
  } catch (err) {
    return {
      results: [],
      usedProvider: "duckduckgo",
      warning: `DuckDuckGo failed: ${(err as Error).message}`,
    };
  }
}

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return "";
  return results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
    .join("\n\n");
}
