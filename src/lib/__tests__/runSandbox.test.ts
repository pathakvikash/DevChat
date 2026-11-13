import { describe, it, expect } from "vitest";
import { runDocument } from "../sandbox";

const FIRST = /^<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="([^"]+)">/;

describe("Run frame document", () => {
  it("each Run document opens with its own CSP as the first head element", () => {
    expect(runDocument("javascript", "1", "c").match(FIRST)?.[1]).toBe(
      "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'",
    );
    expect(runDocument("python", "1", "c").match(FIRST)?.[1]).toBe(
      "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net/pyodide/v0.26.4/full/; connect-src https://cdn.jsdelivr.net/pyodide/v0.26.4/full/",
    );
  });

  it("Python loads Pyodide only from the folder its CSP allows", () => {
    const urls = runDocument("python", "1", "c").match(/https:\/\/[^\s"'`)<>]+/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u.startsWith("https://cdn.jsdelivr.net/pyodide/v0.26.4/full/")).toBe(true);
  });

  it("JavaScript code cannot close the script tag", () => {
    const closers = (d: string) => d.match(/<\/script>/gi)?.length;
    expect(closers(runDocument("javascript", "</script><img src=x>", "c"))).toBe(
      closers(runDocument("javascript", "console.log(1)", "c")),
    );
  });
});
