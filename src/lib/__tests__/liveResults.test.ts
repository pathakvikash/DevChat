import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  requireUserId: vi.fn(),
  getApp: vi.fn(),
  callAppTool: vi.fn(),
  findArtifact: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: vi.fn().mockResolvedValue({ email: "me@x.co" }) }, artifact: { findUnique: h.findArtifact } },
}));
vi.mock("@/lib/auth", () => ({ requireUserId: h.requireUserId, UnauthorizedError: class UnauthorizedError extends Error {} }));
vi.mock("@/lib/apps/registry", () => ({ getApp: h.getApp, callAppTool: h.callAppTool }));

import { POST } from "@/app/api/apps/refresh-result/route";
import { orreryResultSchema } from "@/lib/apps/types";
import { clampEvery, liveDelay, liveExpired, liveFailed, LIVE_SESSION_MS } from "@/lib/generativeUi/livePoll";

const candles = [{ t: 1000, o: 1, h: 2, l: 0.5, c: 1.5 }];
const ohlc = (extra: object = {}) => ({ orrery: 1, type: "ohlc", symbol: "BTC", interval: "1m", candles, ...extra });

describe("refresh in the result schema", () => {
  it("accepts refresh on ohlc, timeseries and table", () => {
    const refresh = { tool: "klines", args: { symbol: "BTC" }, everyMs: 5000 };
    expect(orreryResultSchema.safeParse(ohlc({ refresh })).success).toBe(true);
    expect(orreryResultSchema.safeParse({ orrery: 1, type: "timeseries", series: [], refresh: { tool: "t" } }).success).toBe(true);
    expect(orreryResultSchema.safeParse({ orrery: 1, type: "table", columns: [], rows: [], refresh }).success).toBe(true);
    const r = orreryResultSchema.parse(ohlc({ refresh }));
    expect("refresh" in r && r.refresh).toEqual(refresh);
  });
  it.each([
    ["missing tool", { args: {} }],
    ["empty tool", { tool: "" }],
    ["tool not a string", { tool: 3 }],
    ["args an array", { tool: "k", args: [] }],
    ["everyMs a string", { tool: "k", everyMs: "5" }],
    ["everyMs zero", { tool: "k", everyMs: 0 }],
  ])("rejects %s", (_n, refresh) => {
    expect(orreryResultSchema.safeParse(ohlc({ refresh })).success).toBe(false);
  });
});

describe("live polling rules", () => {
  it("clamps everyMs to 2s..60s with a 5s default", () => {
    expect(clampEvery(undefined)).toBe(5000);
    expect(clampEvery(NaN)).toBe(5000);
    expect(clampEvery(100)).toBe(2000);
    expect(clampEvery(9000)).toBe(9000);
    expect(clampEvery(1e9)).toBe(60_000);
  });
  it("doubles the delay per failure up to 60s and stops after 5", () => {
    expect([0, 1, 2, 3, 4].map((f) => liveDelay(5000, f))).toEqual([5000, 10_000, 20_000, 40_000, 60_000]);
    expect(liveDelay(2000, 9)).toBe(60_000);
    expect(liveFailed(4)).toBe(false);
    expect(liveFailed(5)).toBe(true);
  });
  it("expires after 15 minutes", () => {
    expect(liveExpired(0, LIVE_SESSION_MS - 1)).toBe(false);
    expect(liveExpired(0, LIVE_SESSION_MS)).toBe(true);
  });
});

describe("POST /api/apps/refresh-result", () => {
  let n = 0;
  const post = (artifactId: unknown = `art${++n}`) =>
    POST(new NextRequest("http://localhost/api/apps/refresh-result", { method: "POST", body: JSON.stringify({ artifactId }) }) as any);
  const stored = (extra: object = {}, app: unknown = "trade") => ({
    content: JSON.stringify({ ...ohlc({ refresh: { tool: "klines", args: { symbol: "BTC" } } }), app, ...extra }),
    conversation: { userId: "u1" },
  });
  const tools = [{ name: "klines", readOnly: true }, { name: "order", readOnly: false }];

  beforeEach(() => {
    vi.clearAllMocks();
    h.requireUserId.mockResolvedValue("u1");
    h.findArtifact.mockResolvedValue(stored());
    h.getApp.mockResolvedValue({ id: "trade", tools });
    h.callAppTool.mockResolvedValue({ text: "", structured: ohlc({ candles: [...candles, { t: 2000, o: 1, h: 2, l: 1, c: 2 }] }) });
  });

  it("refuses a signed-out user", async () => {
    h.requireUserId.mockRejectedValue(new (await import("@/lib/auth")).UnauthorizedError());
    expect((await post()).status).toBe(401);
    expect(h.callAppTool).not.toHaveBeenCalled();
  });
  it("404s an artifact that belongs to someone else", async () => {
    h.findArtifact.mockResolvedValue({ ...stored(), conversation: { userId: "other" } });
    expect((await post()).status).toBe(404);
  });
  it("404s an app that is not registered and approved", async () => {
    h.getApp.mockResolvedValue(null);
    expect((await post()).status).toBe(404);
    expect(h.callAppTool).not.toHaveBeenCalled();
  });
  it("refuses a result without refresh or without an app id", async () => {
    h.findArtifact.mockResolvedValue({ content: JSON.stringify({ ...ohlc(), app: "trade" }), conversation: { userId: "u1" } });
    expect((await post()).status).toBe(400);
    h.findArtifact.mockResolvedValue(stored({}, null));
    expect((await post()).status).toBe(400);
  });
  it("never calls a tool that is not read-only", async () => {
    h.findArtifact.mockResolvedValue(stored({ refresh: { tool: "order" } }));
    expect((await post()).status).toBe(400);
    h.findArtifact.mockResolvedValue(stored({ refresh: { tool: "missing" } }));
    expect((await post()).status).toBe(400);
    expect(h.callAppTool).not.toHaveBeenCalled();
  });
  it("ignores tool and args sent by the client", async () => {
    const res = await POST(new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify({ artifactId: "artX", tool: "order", args: { a: 1 } }) }) as any);
    expect(res.status).toBe(200);
    expect(h.callAppTool).toHaveBeenCalledWith("u1", "me@x.co", "trade", "klines", { symbol: "BTC" }, expect.anything());
  });
  it("502s a result of a different type", async () => {
    h.callAppTool.mockResolvedValue({ text: "", structured: { orrery: 1, type: "table", columns: [], rows: [] } });
    expect((await post()).status).toBe(502);
  });
  it("502s when the app returns an error or nothing structured", async () => {
    h.callAppTool.mockResolvedValue({ text: "boom", isError: true });
    expect((await post()).status).toBe(502);
    h.callAppTool.mockResolvedValue({ text: "no data" });
    expect((await post()).status).toBe(502);
  });
  it("returns the validated result, and 429s a second call within 2s", async () => {
    const res = await post("same");
    expect(res.status).toBe(200);
    expect(orreryResultSchema.safeParse(await res.json()).success).toBe(true);
    const again = await post("same");
    expect(again.status).toBe(429);
    expect(Number(again.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect((await post("other")).status).toBe(200);
  });
});
