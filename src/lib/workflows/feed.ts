import { htmlToText } from "@/lib/net/htmlText";

export interface FeedItem {
  title: string;
  url: string;
  publishedAt: string;
  summary: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** Text of an element: CDATA is kept as written, anything else has its entities decoded. */
function text(raw: string): string {
  const parts = raw.split(/(<!\[CDATA\[[\s\S]*?\]\]>)/);
  return parts.map((p) => (p.startsWith("<![CDATA[") ? p.slice(9, -3) : decode(p))).join("").trim();
}

function tag(block: string, name: string): string | undefined {
  // `[^/>]` before the `>` keeps a self-closing `<link href=… />` from matching.
  const m = new RegExp(`<${name}(?:\\s[^>]*[^/>])?>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return m ? text(m[1]) : undefined;
}

/** An Atom entry's link: the alternate one, else the first with an href. */
function atomLink(block: string): string | undefined {
  const links = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)].map((m) => m[1]);
  const pick = links.find((a) => /rel\s*=\s*["']alternate["']/i.test(a)) ?? links.find((a) => !/rel\s*=/i.test(a)) ?? links[0];
  const href = pick && /href\s*=\s*["']([^"']*)["']/i.exec(pick);
  return href ? decode(href[1]) : undefined;
}

function isoDate(s: string | undefined): string {
  if (!s) return "";
  const t = Date.parse(s);
  return Number.isNaN(t) ? s : new Date(t).toISOString();
}

const plain = (html: string | undefined) => (html ? htmlToText(html) : "");

/**
 * Items of an RSS 2.0 or Atom feed. A few regexes, not a full XML parser: it covers the feeds that are published.
 * Throws when the text is not a feed at all; a feed with no entries is an empty list.
 */
export function parseFeed(xml: string): { title: string; items: FeedItem[] } {
  if (!/<(rss|feed|rdf:RDF)\b/i.test(xml) && !/<channel\b/i.test(xml)) throw new Error("Couldn't read this as an RSS or Atom feed");
  const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
  const head = blocks.length ? xml.slice(0, blocks[0].index) : xml;
  const items = blocks.map((m): FeedItem => {
    const b = m[2];
    const guid = tag(b, "guid");
    const link = (tag(b, "link") || atomLink(b) || (guid && /^https?:\/\//i.test(guid) ? guid : "") || "").trim();
    return {
      title: plain(tag(b, "title")),
      url: link,
      publishedAt: isoDate(tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated") ?? tag(b, "dc:date")),
      summary: plain(tag(b, "description") ?? tag(b, "summary") ?? tag(b, "content:encoded") ?? tag(b, "content")).slice(0, 500),
    };
  });
  return { title: plain(tag(head, "title")), items };
}
