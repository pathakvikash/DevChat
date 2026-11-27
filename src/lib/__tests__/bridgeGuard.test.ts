import { describe, it, expect } from "vitest";
import { checkBridgeRequest, corsHeaders, BRIDGE_PORT } from "@/lib/bridge/protocol";

const origin = "https://dev-chat-beta.vercel.app";
const cfg = { token: "t".repeat(43), origins: [origin] };
const good = { method: "GET", host: `127.0.0.1:${BRIDGE_PORT}`, origin, authorization: `Bearer ${cfg.token}` };
const status = (r: ReturnType<typeof checkBridgeRequest>) => (r.ok ? 200 : r.status);

describe("bridge guard", () => {
  it("accepts a good request", () => expect(checkBridgeRequest(good, cfg)).toEqual({ ok: true }));
  it("refuses a rebound Host and localhost", () => {
    expect(status(checkBridgeRequest({ ...good, host: `evil.example:${BRIDGE_PORT}` }, cfg))).toBe(403);
    expect(status(checkBridgeRequest({ ...good, host: `localhost:${BRIDGE_PORT}` }, cfg))).toBe(403);
    expect(status(checkBridgeRequest({ ...good, host: undefined }, cfg))).toBe(403);
  });
  it("refuses Origin null, missing and foreign", () => {
    for (const o of ["null", undefined, "https://evil.example", origin + ".evil.example"]) {
      expect(status(checkBridgeRequest({ ...good, origin: o }, cfg))).toBe(403);
    }
  });
  it("refuses a missing, wrong and different-length token", () => {
    expect(status(checkBridgeRequest({ ...good, authorization: undefined }, cfg))).toBe(401);
    expect(status(checkBridgeRequest({ ...good, authorization: `Bearer ${"x".repeat(43)}` }, cfg))).toBe(401);
    expect(status(checkBridgeRequest({ ...good, authorization: "Bearer short" }, cfg))).toBe(401);
    expect(status(checkBridgeRequest({ ...good, authorization: `Bearer ${cfg.token}0` }, cfg))).toBe(401);
    expect(status(checkBridgeRequest({ ...good, authorization: cfg.token }, cfg))).toBe(401);
  });
  it("needs application/json on POST", () => {
    const post = { ...good, method: "POST" };
    expect(status(checkBridgeRequest({ ...post, contentType: "text/plain" }, cfg))).toBe(415);
    expect(status(checkBridgeRequest({ ...post }, cfg))).toBe(415);
    expect(checkBridgeRequest({ ...post, contentType: "application/json; charset=utf-8" }, cfg).ok).toBe(true);
  });
  it("answers a preflight from an allowed origin without a token, not a foreign one", () => {
    const pre = { method: "OPTIONS", host: good.host, origin };
    expect(checkBridgeRequest(pre, cfg).ok).toBe(true);
    expect(status(checkBridgeRequest({ ...pre, origin: "https://evil.example" }, cfg))).toBe(403);
    expect(status(checkBridgeRequest({ ...pre, host: "localhost:1" }, cfg))).toBe(403);
  });
  it("ignores a token in the query string", () => {
    // The guard takes no URL at all: only the Authorization header counts.
    const req = { ...good, authorization: undefined, url: `/health?token=${cfg.token}` };
    expect(status(checkBridgeRequest(req, cfg))).toBe(401);
  });
  it("cors echoes only an allowed origin", () => {
    const h = corsHeaders(origin, cfg.origins, true);
    expect(h["Access-Control-Allow-Origin"]).toBe(origin);
    expect(h.Vary).toBe("Origin");
    expect(h["Access-Control-Allow-Headers"]).toBe("Authorization, Content-Type");
    expect(h["Access-Control-Allow-Private-Network"]).toBe("true");
    expect(corsHeaders(origin, cfg.origins)["Access-Control-Allow-Private-Network"]).toBeUndefined();
    expect(corsHeaders("https://evil.example", cfg.origins)["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(corsHeaders("null", cfg.origins)["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(corsHeaders(undefined, cfg.origins).Vary).toBe("Origin");
  });
});
