import { describe, it, expect } from "vitest";
import { parseFeed } from "@/lib/workflows/feed";

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Dev &amp; Ops News</title>
    <link>https://news.test/</link>
    <item>
      <title>First &quot;post&quot;</title>
      <link>https://news.test/first</link>
      <pubDate>Mon, 09 Nov 2026 10:00:00 GMT</pubDate>
      <description>Plain &lt;b&gt;bold&lt;/b&gt; text &amp; more</description>
    </item>
    <item>
      <title><![CDATA[Second & <i>third</i>]]></title>
      <guid isPermaLink="true">https://news.test/second</guid>
      <dc:date>2026-11-08T09:00:00Z</dc:date>
      <description><![CDATA[<p>Hello <a href="https://x.test">world</a></p>]]></description>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Blog</title>
  <link href="https://atom.test/" rel="self"/>
  <entry>
    <title type="html">Atom &lt;em&gt;one&lt;/em&gt;</title>
    <link rel="alternate" href="https://atom.test/one"/>
    <link rel="enclosure" href="https://atom.test/one.mp3"/>
    <published>2026-11-07T12:00:00+00:00</published>
    <updated>2026-11-09T12:00:00+00:00</updated>
    <summary>The summary</summary>
  </entry>
  <entry>
    <title>Atom two</title>
    <link href="https://atom.test/two"/>
    <updated>2026-11-06T12:00:00Z</updated>
    <content type="html"><![CDATA[<div>Body <b>text</b></div>]]></content>
  </entry>
</feed>`;

describe("parseFeed", () => {
  it("reads RSS 2.0: titles, links, dates and a plain-text summary", () => {
    const f = parseFeed(RSS);
    expect(f.title).toBe("Dev & Ops News");
    expect(f.items).toHaveLength(2);
    expect(f.items[0]).toEqual({
      title: 'First "post"',
      url: "https://news.test/first",
      publishedAt: "2026-11-09T10:00:00.000Z",
      summary: "Plain bold text & more",
    });
  });

  it("is CDATA aware, and falls back to the guid for the link and dc:date for the date", () => {
    const second = parseFeed(RSS).items[1];
    expect(second.title).toBe("Second & third");
    expect(second.url).toBe("https://news.test/second");
    expect(second.publishedAt).toBe("2026-11-08T09:00:00.000Z");
    expect(second.summary).toBe("Hello world");
  });

  it("reads Atom: the alternate link, published before updated, summary or content", () => {
    const f = parseFeed(ATOM);
    expect(f.title).toBe("Atom Blog");
    expect(f.items[0]).toEqual({ title: "Atom one", url: "https://atom.test/one", publishedAt: "2026-11-07T12:00:00.000Z", summary: "The summary" });
    expect(f.items[1]).toMatchObject({ title: "Atom two", url: "https://atom.test/two", publishedAt: "2026-11-06T12:00:00.000Z", summary: "Body text" });
  });

  it("returns no items for a feed with none, and throws for something that is not a feed", () => {
    expect(parseFeed(`<rss version="2.0"><channel><title>Empty</title></channel></rss>`)).toEqual({ title: "Empty", items: [] });
    expect(() => parseFeed("<html><body>Not a feed</body></html>")).toThrow(/RSS or Atom/);
    expect(() => parseFeed("")).toThrow(/RSS or Atom/);
  });

  it("keeps an unparseable date as written and cuts a long summary", () => {
    const f = parseFeed(`<rss><channel><item><title>T</title><link>https://a.test</link><pubDate>last Tuesday</pubDate><description>${"x".repeat(900)}</description></item></channel></rss>`);
    expect(f.items[0].publishedAt).toBe("last Tuesday");
    expect(f.items[0].summary).toHaveLength(500);
  });
});
