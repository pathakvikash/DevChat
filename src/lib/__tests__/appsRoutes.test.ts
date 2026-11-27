import { describe, it, expect, vi, beforeEach } from "vitest";
import { jwtVerify } from "jose";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  requireUserId: vi.fn(),
  canUseHostTools: vi.fn(),
  getApp: vi.fn(),
  listApps: vi.fn(),
  registerApp: vi.fn(),
  previewApp: vi.fn(),
  refreshApp: vi.fn(),
  removeApp: vi.fn(),
  callAppTool: vi.fn(),
  openAppFile: vi.fn(),
  getAppSecret: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique: vi.fn().mockResolvedValue({ email: "me@x.co" }) } } }));
vi.mock("@/lib/auth", () => ({
  requireUserId: h.requireUserId,
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/hostAccess", () => ({ canUseHostTools: h.canUseHostTools }));
vi.mock("@/lib/apps/registry", () => h);

import { GET as list, POST as register } from "@/app/api/apps/route";
import { POST as preview } from "@/app/api/apps/preview/route";
import { DELETE as remove } from "@/app/api/apps/[id]/route";
import { POST as refresh } from "@/app/api/apps/[id]/refresh/route";
import { GET as go } from "@/app/api/apps/[id]/go/route";
import { GET as job } from "@/app/api/apps/[id]/jobs/[jobId]/route";
import { GET as file } from "@/app/api/apps/[id]/file/route";
import { buildGoUrl, GoError } from "@/lib/apps/go";
import { ManifestError } from "@/lib/apps/manifest";

const app = {
  id: "pp",
  name: "Print",
  baseUrl: "https://pp.example.com",
  ssoPath: "/sso",
  deepLinks: { quote: "/quote?file={file}" },
  tools: [{ name: "status", readOnly: true }, { name: "order", readOnly: false }],
  goodFor: "g",
  permission: "read",
  capabilities: [],
  status: "ok",
  approved: true,
};
const ctx = (p: Record<string, string> = { id: "pp" }): any => ({ params: Promise.resolve(p) });
const req = (path: string, init?: RequestInit) => new NextRequest(`http://localhost${path}`, init as any) as any;
const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  h.requireUserId.mockResolvedValue("u1");
  h.canUseHostTools.mockResolvedValue(true);
  h.getApp.mockResolvedValue(app);
  h.getAppSecret.mockResolvedValue("handoff-secret-handoff-secret-12");
});

describe("owner gating", () => {
  beforeEach(() => h.canUseHostTools.mockResolvedValue(false));

  it("refuses preview, register, refresh and delete for non-owners", async () => {
    expect((await preview(req("/api/apps/preview", json({ url: "https://x" })))).status).toBe(403);
    expect((await register(req("/api/apps", json({ url: "https://x", approve: true })))).status).toBe(403);
    expect((await refresh(req("/x", { method: "POST" }), ctx())).status).toBe(403);
    expect((await remove(req("/x", { method: "DELETE" }), ctx())).status).toBe(403);
    expect(h.registerApp).not.toHaveBeenCalled();
    expect(h.removeApp).not.toHaveBeenCalled();
  });

  it("lets a normal user list only approved apps, without the approved flag", async () => {
    h.listApps.mockResolvedValue([app]);
    const res = await list(req("/api/apps"));
    expect(h.listApps).toHaveBeenCalledWith("u1", { includeUnapproved: false });
    const body = await res.json();
    expect(body[0]).not.toHaveProperty("approved");
    expect(body[0]).not.toHaveProperty("tools");
  });
});

describe("owner routes", () => {
  it("returns 401 without a session", async () => {
    const { UnauthorizedError } = await import("@/lib/auth");
    h.requireUserId.mockRejectedValue(new UnauthorizedError());
    expect((await list(req("/api/apps"))).status).toBe(401);
  });

  it("registers only with approve: true", async () => {
    expect((await register(req("/api/apps", json({ url: "https://x" })))).status).toBe(400);
    h.registerApp.mockResolvedValue({ app, secret: "s" });
    const res = await register(req("/api/apps", json({ url: "https://pp.example.com", approve: true })));
    expect(await res.json()).toEqual({ app, secret: "s" });
    expect(h.registerApp).toHaveBeenCalledWith("https://pp.example.com", "u1", "me@x.co");
  });

  it("turns a re-register conflict into a 409", async () => {
    const { ConflictError } = await import("@/lib/apps/types");
    h.registerApp.mockRejectedValue(new ConflictError("remove it first"));
    expect((await register(req("/api/apps", json({ url: "https://x", approve: true })))).status).toBe(409);
  });

  it("turns a manifest problem into a 400", async () => {
    h.previewApp.mockRejectedValue(new ManifestError("baseUrl must be on https://x"));
    const res = await preview(req("/api/apps/preview", json({ url: "https://x" })));
    expect(res.status).toBe(400);
  });

  it("404s on refresh and delete of an unknown app", async () => {
    h.refreshApp.mockResolvedValue(null);
    h.removeApp.mockResolvedValue(false);
    expect((await refresh(req("/x", { method: "POST" }), ctx())).status).toBe(404);
    expect((await remove(req("/x", { method: "DELETE" }), ctx())).status).toBe(404);
  });
});

describe("GET /api/apps/[id]/go", () => {
  it("302s to the sso path with a handoff token and the encoded same-origin next path", async () => {
    const res = await go(req(`/api/apps/pp/go?link=quote&params=${encodeURIComponent(JSON.stringify({ file: "a b&c=d.stl" }))}`), ctx());
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://pp.example.com/sso");
    expect(loc.searchParams.get("next")).toBe("/quote?file=a%20b%26c%3Dd.stl");
    const { payload } = await jwtVerify(loc.searchParams.get("token")!, new TextEncoder().encode("handoff-secret-handoff-secret-12"), { audience: "pp" });
    expect(payload).toMatchObject({ sub: "me@x.co", purpose: "sso" });
  });

  it("404s an unapproved or unknown app and 400s an unknown link", async () => {
    h.getApp.mockResolvedValueOnce(null);
    expect((await go(req("/x?link=quote"), ctx())).status).toBe(404);
    expect((await go(req("/x?link=evil"), ctx())).status).toBe(400);
  });
});

describe("buildGoUrl", () => {
  const token = async () => "T";
  it("goes straight to the deep link without sso, encoding params", async () => {
    const url = await buildGoUrl({ ...app, ssoPath: undefined }, "quote", JSON.stringify({ file: "../../x?y#z" }), token);
    expect(url).toBe("https://pp.example.com/quote?file=..%2F..%2Fx%3Fy%23z");
  });
  it("rejects a template that would leave the origin", async () => {
    await expect(buildGoUrl({ ...app, ssoPath: undefined, deepLinks: { x: "//evil.example.com/p" } }, "x", null, token)).rejects.toBeInstanceOf(GoError);
  });
  it("rejects missing params and non-object params", async () => {
    await expect(buildGoUrl(app, "quote", null, token)).rejects.toThrow(/Missing param/);
    await expect(buildGoUrl(app, "quote", "[1]", token)).rejects.toThrow(/JSON object/);
  });
  it.each([null, "home"])("opens the app root for link=%s when there is no home deep link", async (link) => {
    expect(await buildGoUrl({ ...app, ssoPath: undefined }, link, null, token)).toBe("https://pp.example.com/");
    const sso = new URL(await buildGoUrl(app, link, null, token));
    expect(sso.origin + sso.pathname).toBe("https://pp.example.com/sso");
    expect(sso.searchParams.get("next")).toBe("/");
  });
  it("uses the manifest's own home link when it has one", async () => {
    expect(await buildGoUrl({ ...app, ssoPath: undefined, deepLinks: { home: "/start" } }, "home", null, token)).toBe("https://pp.example.com/start");
  });
  it("ignores prototype keys as link names", async () => {
    await expect(buildGoUrl(app, "constructor", null, token)).rejects.toThrow(/Unknown link/);
  });
});

describe("GET /api/apps/[id]/jobs/[jobId]", () => {
  const c = ctx({ id: "pp", jobId: "j1" });
  const H = { headers: { "X-Orrery-Job": "1" } };
  it("calls the app's own read-only status tool with the jobId", async () => {
    h.callAppTool.mockResolvedValue({ text: "", job: { state: "running", progress: 5 } });
    const res = await job(req("/x?tool=status", H), c);
    expect(await res.json()).toEqual({ state: "running", progress: 5 });
    expect(h.callAppTool.mock.calls[0].slice(0, 5)).toEqual(["u1", "me@x.co", "pp", "status", { jobId: "j1" }]);
  });
  it("400s a tool that is unknown or not read-only", async () => {
    expect((await job(req("/x?tool=deleteEverything", H), c)).status).toBe(400);
    expect((await job(req("/x?tool=order", H), c)).status).toBe(400);
    expect((await job(req("/x", H), c)).status).toBe(400);
    expect(h.callAppTool).not.toHaveBeenCalled();
  });
  it("400s without the X-Orrery-Job header", async () => {
    expect((await job(req("/x?tool=status"), c)).status).toBe(400);
    expect(h.callAppTool).not.toHaveBeenCalled();
  });
});

describe("GET /api/apps/[id]/file", () => {
  it.each(["", "../etc/passwd", "a/b.stl", ".hidden", "a b.stl", "x".repeat(129)])("404s the bad name %j", async (name) => {
    const res = await file(req(`/x?name=${encodeURIComponent(name)}`), ctx());
    expect(res.status).toBe(404);
    expect(h.openAppFile).not.toHaveBeenCalled();
  });

  it("streams with a forced content type and inline disposition", async () => {
    h.openAppFile.mockResolvedValue(new Response(new Uint8Array([0, 255, 128, 7]), { headers: { "content-type": "text/html" } }));
    const res = await file(req("/x?name=part-1.stl"), ctx());
    expect(res.headers.get("content-type")).toBe("model/stl");
    expect(res.headers.get("content-disposition")).toBe("inline");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([0, 255, 128, 7]);
    expect(h.openAppFile.mock.calls[0].slice(0, 3)).toEqual(["pp", "me@x.co", "part-1.stl"]);
  });

  it("refuses an oversize declared length and an unapproved app", async () => {
    h.openAppFile.mockResolvedValue(new Response("x", { headers: { "content-length": String(26 * 1024 * 1024) } }));
    expect((await file(req("/x?name=a.stl"), ctx())).status).toBe(413);
    h.getApp.mockResolvedValueOnce(null);
    expect((await file(req("/x?name=a.stl"), ctx())).status).toBe(404);
  });
});
