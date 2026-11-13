import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
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

// A page with just enough DOM for sandbox.ts: fake iframes and a window that keeps its message listeners.
function fakePage() {
  const frames: any[] = [];
  const listeners = new Set<(e: any) => void>();
  vi.stubGlobal("document", {
    body: { appendChild: () => {} },
    createElement: () => {
      const f: any = {
        sandbox: { add: () => {} },
        style: {},
        isConnected: true,
        contentWindow: { postMessage: vi.fn() },
        addEventListener: () => {},
        remove: () => (f.isConnected = false),
      };
      frames.push(f);
      return f;
    },
  });
  vi.stubGlobal("window", {
    addEventListener: (_: string, fn: any) => listeners.add(fn),
    removeEventListener: (_: string, fn: any) => listeners.delete(fn),
  });
  return { frames, send: (data: unknown, source: unknown) => listeners.forEach((fn) => fn({ data, source })) };
}

describe("Run frames in the page", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("Python gets a fresh frame when the chat changes", async () => {
    const page = fakePage();
    const { runCode } = await import("../sandbox");
    void runCode("python", "x = 1", "chat-a");
    void runCode("python", "print(x)", "chat-a");
    expect(page.frames).toHaveLength(1);
    void runCode("python", "print(x)", "chat-b");
    expect(page.frames).toHaveLength(2);
    expect(page.frames[0].isConnected).toBe(false);
    expect(page.frames[1].isConnected).toBe(true);
  });

  it("a reply that is not a string, or not from the frame, is ignored", async () => {
    const page = fakePage();
    const { runCode } = await import("../sandbox");
    const done = vi.fn();
    void runCode("javascript", "1").then(done);
    const frame = page.frames[0];
    const channel = /channel: '([^']+)'/.exec(frame.srcdoc)![1];
    page.send({ channel, output: "from elsewhere" }, {});
    page.send({ channel, output: { evil: true } }, frame.contentWindow);
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith("(no output)");
  });
});
