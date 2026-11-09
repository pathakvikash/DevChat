import { describe, it, expect, vi } from "vitest";

const safeFetch = vi.fn();
vi.mock("@/lib/net/safeFetch", () => ({ safeFetch: (...a: unknown[]) => safeFetch(...a), SafeFetchError: class extends Error {} }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/rag", () => ({}));

import { TOOL_REGISTRY } from "@/lib/registry/tools";

const run = (url = "https://a.test/x") => (TOOL_REGISTRY.fetchUrl.execute as (i: { url: string }, o?: unknown) => Promise<string>)({ url }, {});
const res = (contentType: string, text: string) => ({ status: 200, ok: true, url: "https://a.test/x", contentType, text });

describe("the fetchUrl tool", () => {
  it("marks JSON and text that were cut at 8,000 characters, and leaves short ones alone", async () => {
    safeFetch.mockResolvedValue(res("application/json", JSON.stringify({ a: "x".repeat(9000) })));
    expect(await run()).toMatch(/\n…\[truncated\]$/);
    safeFetch.mockResolvedValue(res("application/json", '{"a":1}'));
    expect(await run()).toBe('{"a":1}');
    safeFetch.mockResolvedValue(res("text/plain", "line\n".repeat(3000)));
    expect(await run()).toMatch(/\n…\[truncated\]$/);
  });

  it("keeps plain text as it is", async () => {
    safeFetch.mockResolvedValue(res("text/plain", "a\nconst x = <T,>() => <div/>;"));
    expect(await run()).toBe("a\nconst x = <T,>() => <div/>;");
  });
});
