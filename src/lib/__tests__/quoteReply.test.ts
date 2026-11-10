import { describe, it, expect } from "vitest";
import { composeQuoteMessage, splitQuoteBlocks } from "@/lib/utils/quoteReply";

describe("composeQuoteMessage", () => {
  it("puts the instruction under its quote", () => {
    expect(composeQuoteMessage([{ text: "the cache", instruction: "why?" }], "")).toBe(
      "> the cache\n\nwhy?",
    );
  });

  it("keeps two quotes and the typed text in order", () => {
    const out = composeQuoteMessage(
      [
        { text: "one", instruction: "first" },
        { text: "two", instruction: "second" },
      ],
      "and overall?",
    );
    expect(out).toBe("> one\n\nfirst\n\n> two\n\nsecond\n\nand overall?");
  });

  it("prefixes every line of a multi-line quote", () => {
    const out = composeQuoteMessage([{ text: "a\n\nb\r\nc", instruction: "" }], "");
    expect(out).toBe("> a\n>\n> b\n> c");
  });

  it("adds no instruction line when it is empty", () => {
    expect(composeQuoteMessage([{ text: "q", instruction: "  " }], "typed")).toBe("> q\n\ntyped");
  });

  it("keeps the first line's indentation and drops only blank lines and trailing space", () => {
    const out = composeQuoteMessage([{ text: "\n  \n    if (x) {\n      y();\n    }  \n\n", instruction: "" }], "");
    expect(out).toBe(">     if (x) {\n>       y();\n>     }");
  });

  it("returns the text unchanged with no cards", () => {
    expect(composeQuoteMessage([], "  hello\nworld ")).toBe("  hello\nworld ");
  });
});

describe("splitQuoteBlocks", () => {
  it("leaves plain text alone", () => {
    expect(splitQuoteBlocks("just text\nmore")).toEqual([{ type: "text", text: "just text\nmore" }]);
  });

  it("splits a leading quote run from the text after it", () => {
    expect(splitQuoteBlocks("> a\n> b\n\nreply")).toEqual([
      { type: "quote", text: "a\nb" },
      { type: "text", text: "reply" },
    ]);
  });

  it("splits a quote run in the middle", () => {
    expect(splitQuoteBlocks("before\n\n> q\n\nafter")).toEqual([
      { type: "text", text: "before" },
      { type: "quote", text: "q" },
      { type: "text", text: "after" },
    ]);
  });

  it("does not treat a > mid-line as a quote", () => {
    expect(splitQuoteBlocks("a > b\nx>y")).toEqual([{ type: "text", text: "a > b\nx>y" }]);
  });

  it("round-trips what composeQuoteMessage writes", () => {
    const msg = composeQuoteMessage(
      [
        { text: "one\ntwo", instruction: "why" },
        { text: "three", instruction: "" },
      ],
      "typed",
    );
    expect(splitQuoteBlocks(msg).map((s) => s.type)).toEqual(["quote", "text", "quote", "text"]);
  });
});
