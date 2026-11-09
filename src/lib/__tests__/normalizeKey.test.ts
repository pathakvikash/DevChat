import { describe, it, expect } from "vitest";
import { normalizeKey } from "@/lib/workflows/tables";

describe("normalizeKey", () => {
  it("lowercases the host, drops a trailing slash and utm_ parameters", () => {
    expect(normalizeKey("https://News.Example.com/Post/1/?utm_source=x&utm_medium=y")).toBe("https://news.example.com/Post/1");
    expect(normalizeKey("HTTP://Example.com/")).toBe("http://example.com");
    expect(normalizeKey("https://example.com/a?id=5&UTM_campaign=z&b=2")).toBe("https://example.com/a?id=5&b=2");
  });

  it("keeps the path case and other parameters", () => {
    expect(normalizeKey("https://example.com/Jobs?gh_jid=42")).toBe("https://example.com/Jobs?gh_jid=42");
  });

  it("makes the same key from the ways one page is linked", () => {
    const a = normalizeKey("https://jobs.example.com/role/1");
    expect(normalizeKey("https://JOBS.example.com/role/1/")).toBe(a);
    expect(normalizeKey("https://jobs.example.com/role/1?utm_source=newsletter")).toBe(a);
  });

  it("rebuilds the query, so %20 and + are one key, with or without utm_ parameters", () => {
    expect(normalizeKey("https://a.test/p?q=a%20b")).toBe(normalizeKey("https://a.test/p?q=a+b"));
    expect(normalizeKey("https://a.test/p?q=a%20b&utm_source=x")).toBe(normalizeKey("https://a.test/p?q=a%20b"));
    expect(normalizeKey("https://a.test/p?utm_source=x&q=a%20b")).toBe("https://a.test/p?q=a+b");
  });

  it("stores the sha256 of a key over 1,000 characters, and a short key as it is", () => {
    const long = `https://a.test/${"x".repeat(1200)}`;
    const k = normalizeKey(long);
    expect(k).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(normalizeKey(long)).toBe(k);
    expect(normalizeKey(`${long}/?utm_source=a`)).toBe(k);
    expect(normalizeKey(`${long}y`)).not.toBe(k);
    expect(normalizeKey(`https://a.test/${"x".repeat(900)}`).length).toBeLessThanOrEqual(1000);
  });

  it("only trims anything that is not a URL", () => {
    expect(normalizeKey("  ABC-1  ")).toBe("ABC-1");
    expect(normalizeKey(42)).toBe("42");
    expect(normalizeKey(null)).toBe("");
    expect(normalizeKey("https://")).toBe("https://");
  });
});
