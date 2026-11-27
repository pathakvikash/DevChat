import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { orreryResultSchema } from "../apps/types";
import {
  OrreryAuthError,
  createJtiStore,
  createMcpHandler,
  defineManifest,
  job,
  link,
  model3d,
  ohlc,
  safeNext,
  ssoHandler,
  table,
  timeseries,
  toolResult,
  verifyHandoffToken,
  verifyOrreryToken,
} from "../../../kit/orrery-app-kit/src";

const SECRET = "s3cret";
const APP = "demo-app";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
let n = 0;
function mint(over: Record<string, unknown> = {}, o: { secret?: string; alg?: string } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: o.alg ?? "HS256", typ: "JWT" });
  const body = b64({ iss: "orrery", aud: APP, sub: "a@b.co", iat: now, exp: now + 60, jti: `j${n++}`, ...over });
  const sig = o.alg === "none" ? "" : createHmac("sha256", o.secret ?? SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
const opts = { secret: SECRET, appId: APP };
const bearer = (t: string) => `Bearer ${t}`;
const now = () => Math.floor(Date.now() / 1000);

describe("verifyOrreryToken", () => {
  it("accepts a good token", () => {
    expect(verifyOrreryToken(bearer(mint({ jti: "x1" })), opts)).toEqual({ email: "a@b.co", jti: "x1" });
  });
  it.each([
    ["wrong secret", mint({}, { secret: "nope" })],
    ["wrong aud", mint({ aud: "other" })],
    ["wrong iss", mint({ iss: "evil" })],
    ["expired", mint({ iat: now() - 200, exp: now() - 100 })],
    ["future iat", mint({ iat: now() + 500, exp: now() + 560 })],
    ["alg none", mint({}, { alg: "none" })],
  ])("rejects %s", (_n, t) => {
    expect(() => verifyOrreryToken(bearer(t), opts)).toThrow(OrreryAuthError);
  });
  it("tolerates skew", () => {
    expect(verifyOrreryToken(bearer(mint({ iat: now() - 70, exp: now() - 10 })), opts).email).toBe("a@b.co");
    expect(() => verifyOrreryToken(bearer(mint({ iat: now() - 70, exp: now() - 10 })), { ...opts, skewSeconds: 0 })).toThrow();
  });
  it("rejects missing header", () => {
    expect(() => verifyOrreryToken(null, opts)).toThrow(OrreryAuthError);
  });
  it("jti store blocks reuse", () => {
    const jtiStore = createJtiStore({ ttlSeconds: 60 });
    const t = bearer(mint());
    verifyOrreryToken(t, { ...opts, jtiStore });
    expect(() => verifyOrreryToken(t, { ...opts, jtiStore })).toThrow(/already used/);
  });
});

describe("handoff + sso", () => {
  it("requires purpose sso and single use", () => {
    expect(() => verifyHandoffToken(mint(), opts)).toThrow(/purpose/);
    const t = mint({ purpose: "sso" });
    expect(verifyHandoffToken(t, opts).email).toBe("a@b.co");
    expect(() => verifyHandoffToken(t, opts)).toThrow(/already used/);
  });
  it("redirects same-origin only", async () => {
    const h = ssoHandler({ ...opts, mintSession: () => "sid=1; HttpOnly" });
    const r = await h(new Request(`https://app.test/sso?token=${mint({ purpose: "sso" })}&next=//evil.com`));
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("https://app.test/");
    expect(r.headers.get("set-cookie")).toContain("sid=1");
    const bad = await h(new Request("https://app.test/sso?token=zzz"));
    expect(bad.status).toBe(401);
    expect(safeNext("/quote?file=1")).toBe("/quote?file=1");
    expect(safeNext("https://evil.com")).toBe("/");
  });
});

describe("mcp handler", () => {
  const handler = createMcpHandler({
    name: "demo",
    version: "1.0.0",
    authenticate: (req) => verifyOrreryToken(req.headers.get("authorization"), opts),
    tools: [
      {
        name: "list_things",
        description: "List things",
        inputSchema: { type: "object", properties: {} },
        readOnly: true,
        handler: (_a, ctx) => toolResult(table(["who"], [[ctx.email]]), "1 row"),
      },
    ],
  });
  const call = (body: unknown, auth = bearer(mint())) =>
    handler(new Request("https://app.test/api/mcp", { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) }));
  const rpc = (method: string, params?: unknown, notification = false) => ({ jsonrpc: "2.0", ...(notification ? {} : { id: 1 }), method, params });

  it("initialize", async () => {
    const r = await call(rpc("initialize", {}));
    expect(r.headers.get("content-type")).toBe("application/json");
    expect((await r.json()).result.serverInfo.name).toBe("demo");
  });
  it("notification gets 202", async () => {
    expect((await call(rpc("notifications/initialized", undefined, true))).status).toBe(202);
  });
  it("ping", async () => {
    expect((await (await call(rpc("ping"))).json()).result).toEqual({});
  });
  it("tools/list shows readOnlyHint", async () => {
    const j = await (await call(rpc("tools/list"))).json();
    expect(j.result.tools[0].annotations.readOnlyHint).toBe(true);
  });
  it("tools/call returns structuredContent", async () => {
    const j = await (await call(rpc("tools/call", { name: "list_things", arguments: {} }))).json();
    expect(orreryResultSchema.parse(j.result.structuredContent)).toMatchObject({ rows: [["a@b.co"]] });
    expect(j.result.content[0].text).toBe("1 row");
  });
  it("401 when unauthorized", async () => {
    expect((await call(rpc("ping"), "Bearer bad")).status).toBe(401);
  });
  it("errors for unknown method and tool; 405 on GET", async () => {
    expect((await (await call(rpc("nope"))).json()).error.code).toBe(-32601);
    expect((await (await call(rpc("tools/call", { name: "x" }))).json()).error.code).toBe(-32602);
    expect((await handler(new Request("https://app.test/api/mcp"))).status).toBe(405);
  });
});

describe("result builders", () => {
  it("match orreryResultSchema", () => {
    const all = [
      table(["a"], [[1]], "t"),
      timeseries([{ name: "s", points: [[1, 2]] }]),
      ohlc("BTC", "1h", [{ t: 1, o: 1, h: 2, l: 0, c: 1, v: 5 }]),
      model3d("f1.stl", "m"),
      job("j1", "job_status", { pollMs: 2000 }),
      link("Quote", "quote", { file: "f1" }),
    ];
    for (const r of all) expect(() => orreryResultSchema.parse(r)).not.toThrow();
  });
  it("enforces caps", () => {
    expect(() => table(["a"], Array.from({ length: 1001 }, () => [1]))).toThrow(/cap/);
  });
});

describe("defineManifest", () => {
  const good = {
    manifestVersion: 1 as const,
    id: "demo-app",
    name: "Demo",
    baseUrl: "https://demo.vercel.app",
    description: "d",
    goodFor: "g",
    mcp: { url: "https://demo.vercel.app/api/mcp" },
    auth: "orrery-jwt" as const,
    permission: "read" as const,
  };
  it("fills defaults", () => {
    expect(defineManifest(good)).toMatchObject({ capabilities: [], deepLinks: {} });
  });
  it("lists every problem", () => {
    expect(() => defineManifest({ ...good, id: "X", mcp: { url: "https://other.app/mcp" }, baseUrl: "http://demo.vercel.app" })).toThrow(/id:[\s\S]*https required/);
    expect(() => defineManifest({ ...good, mcp: { url: "https://other.app/mcp" } })).toThrow(/share origin/);
  });
});
