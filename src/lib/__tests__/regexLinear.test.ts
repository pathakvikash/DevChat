import { describe, it, expect } from "vitest";
import { parseFeed } from "@/lib/workflows/feed";
import { htmlToText } from "@/lib/net/htmlText";

// Unclosed markup made each lazy scan run to the end of a 2 MB body again and again (minutes). These must stay linear.
const MB2 = 2 * 1024 * 1024;
const fill = (unit: string) => unit.repeat(Math.ceil(MB2 / unit.length));
const took = (fn: () => unknown) => {
  const t = performance.now();
  fn();
  return performance.now() - t;
};
const LIMIT_MS = 2000; // generous for a loaded machine; the quadratic versions take minutes

describe("a 2 MB malformed feed", () => {
  const head = "<rss><channel><title>T</title>";
  it.each([
    ["unclosed items", fill("<item><title>x")],
    ["unclosed titles", `<item>${fill("<title>x")}</item>`],
    ["unclosed CDATA", `<item><title>${fill("<![CDATA[x")}</title></item>`],
    ["self-closing links", `<entry>${fill("<link href=a ")}</entry>`],
    ["bare angle brackets", `<item>${fill("<<<<")}</item>`],
  ])("parses %s fast", (_name, body) => {
    expect(took(() => parseFeed(`${head}${body}`))).toBeLessThan(LIMIT_MS);
  });
});

describe("2 MB of malformed HTML", () => {
  it.each([
    ["unclosed scripts", fill("<script>x")],
    ["unclosed styles", fill("<style>x")],
    ["unclosed comments", fill("<!--x")],
    ["bare angle brackets", fill("<a ")],
  ])("reads %s fast", (_name, html) => {
    expect(took(() => htmlToText(html))).toBeLessThan(LIMIT_MS);
  });
});

describe("normal markup still reads", () => {
  it("strips scripts, styles and comments", () => {
    expect(htmlToText("<p>a</p><script>x()</script><style>p{}</style><!-- c --><p>b &amp; c</p>")).toBe("a b & c");
  });
  it("keeps what follows an unclosed script", () => {
    expect(htmlToText("<p>a</p><script>never closed <p>b</p>")).toBe("a never closed b");
  });
  it("reads a feed with spaces in the tags", () => {
    const f = parseFeed(`<rss><channel><title >T</title ><item ><title >One</title ><link >https://a.test/1</link ></item></channel></rss>`);
    expect(f.title).toBe("T");
    expect(f.items).toMatchObject([{ title: "One", url: "https://a.test/1" }]);
  });
});
