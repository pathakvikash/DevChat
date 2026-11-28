import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { describe, expect, it } from "vitest";
import { remarkSoftBreaks } from "@/lib/markdownBreaks";

const html = (md: string) => renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkSoftBreaks] }, md));
const brs = (s: string) => (s.match(/<br\s*\/?>/g) ?? []).length;

describe("remarkSoftBreaks", () => {
  it("turns a soft line break into one line break", () => {
    const out = html("one\ntwo");
    expect(brs(out)).toBe(1);
    expect(out.replace("\n", "")).toBe("<p>one<br/>two</p>");
  });

  it("keeps a hard break as one line break, not two", () => {
    for (const md of ["one  \ntwo", "one\\\ntwo"]) {
      const out = html(md);
      expect(brs(out), md).toBe(1);
      expect(out.replace(/<br\s*\/?>\n?/, "|")).toBe("<p>one|two</p>");
    }
  });

  it("leaves fenced code as it is", () => {
    const out = html("```\na\nb\n```");
    expect(brs(out)).toBe(0);
    expect(out).toContain("a\nb");
  });
});
