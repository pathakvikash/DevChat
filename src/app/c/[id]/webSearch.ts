"use client";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function runWebSearch(query: string): Promise<WebSearchResult[]> {
  const res = await fetch(`/api/web-search?q=${encodeURIComponent(query)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results || []) as WebSearchResult[];
}

export function formatWebSearchResults(results: WebSearchResult[]): string {
  return results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
    .join("\n\n");
}
