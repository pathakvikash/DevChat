import { describe, it, expect } from "vitest";
import { parseCardOutput } from "@/lib/workflows/cards/agent";
import { extractJson } from "@/lib/workflows/generate";
import { parseDdgResults } from "@/lib/search";

// Model output and search pages are untrusted text. Many openers with no closer made the lazy patterns rescan to the
// end of the text for each opener; they must stay linear.
const MB1 = 1024 * 1024;
const fill = (unit: string) => unit.repeat(Math.ceil(MB1 / unit.length));
const took = (fn: () => unknown) => {
  const t = performance.now();
  fn();
  return performance.now() - t;
};
const LIMIT_MS = 2000; // the quadratic patterns take minutes

describe("1 MB of unclosed fences and links", () => {
  it.each([
    ["json fences with no closer", fill("```json\n{\"a\":")],
    ["fences with text between", fill("```json x ")],
    ["bare fences", fill("```")],
    ["one opener then a long whitespace run", "```json" + "\n".repeat(200_000)],
  ])("the agent output parser reads %s fast", (_n, text) => {
    expect(took(() => parseCardOutput(text, []))).toBeLessThan(LIMIT_MS);
  });

  it.each([
    ["json fences with no closer", fill("```json\n{\"nodes\":")],
    ["bare fences", fill("```")],
  ])("the flow extractor reads %s fast", (_n, text) => {
    expect(took(() => extractJson(text))).toBeLessThan(LIMIT_MS);
  });

  it.each([
    ["links with no closing tag", fill('<a class="result__a" href="https://a.test">x')],
    ["openers with no snippet", fill('<a class="result__a" href="https://a.test">t</a>')],
    ["bare angle brackets", fill("<a <a ")],
  ])("the DuckDuckGo parser reads %s fast", (_n, html) => {
    expect(took(() => parseDdgResults(html))).toBeLessThan(LIMIT_MS);
  });
});

describe("the tempered patterns still read normal text", () => {
  it("the last json fence wins in an agent report", () => {
    expect(parseCardOutput('first\n```json\n{"score": 1}\n```\nthen\n```json\n{"score": 72}\n```', [{ name: "score", type: "number", description: "" }])).toMatchObject({ ok: true, value: { score: 72 } });
  });
  it("a flow in a plain fence is found", () => {
    expect(extractJson('Here\n```\n{"nodes": []}\n```')).toEqual({ nodes: [] });
  });
  it("two results with titles and snippets", () => {
    const html =
      '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.test%2F1">One</a><a class="result__snippet">Snip <b>1</b></a>' +
      '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fb.test%2F2">Two</a><a class="result__snippet">Snip 2</a>';
    expect(parseDdgResults(html)).toEqual([
      { title: "One", url: "https://a.test/1", snippet: "Snip 1" },
      { title: "Two", url: "https://b.test/2", snippet: "Snip 2" },
    ]);
  });
});
