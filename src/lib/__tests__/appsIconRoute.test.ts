import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GET } from "@/app/api/apps/[id]/icon/route";
import { AppIcon } from "@/app/components/AppIcon";

vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique: vi.fn().mockResolvedValue({ email: "a@b.c" }) } } }));
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn(), UnauthorizedError: class UnauthorizedError extends Error {} }));
vi.mock("@/lib/hostAccess", () => ({ canUseHostTools: vi.fn() }));
vi.mock("@/lib/apps/registry", () => ({ getApp: vi.fn() }));
vi.mock("@/lib/net/safeFetch", () => ({ appFetch: vi.fn() }));

import { requireUserId, UnauthorizedError } from "@/lib/auth";
import { getApp } from "@/lib/apps/registry";
import { appFetch } from "@/lib/net/safeFetch";

const ctx = { params: Promise.resolve({ id: "pp" }) };
const get = () => GET(new Request("http://localhost/api/apps/pp/icon") as any, ctx);
const app = (icon = "https://pp.example/icon.png") => ({ id: "pp", baseUrl: "https://pp.example", icon });
const upstream = (body: BodyInit, type: string) => vi.mocked(appFetch).mockResolvedValue(new Response(body, { headers: { "content-type": type } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUserId).mockResolvedValue("u1");
  vi.mocked(getApp).mockResolvedValue(app() as any);
});

describe("GET /api/apps/[id]/icon", () => {
  it("401 when signed out", async () => {
    vi.mocked(requireUserId).mockRejectedValue(new UnauthorizedError());
    expect((await get()).status).toBe(401);
  });
  it("404 for an unknown app", async () => {
    vi.mocked(getApp).mockResolvedValue(null);
    expect((await get()).status).toBe(404);
  });
  it("404 for an icon on another origin, without fetching", async () => {
    vi.mocked(getApp).mockResolvedValue(app("https://evil.example/i.png") as any);
    expect((await get()).status).toBe(404);
    expect(appFetch).not.toHaveBeenCalled();
  });
  it("404 for SVG", async () => {
    upstream("<svg/>", "image/svg+xml");
    expect((await get()).status).toBe(404);
  });
  it("404 for a body over 256 KB", async () => {
    upstream(new Uint8Array(256 * 1024 + 1), "image/png");
    expect((await get()).status).toBe(404);
  });
  it("serves a PNG with the locked-down headers", async () => {
    upstream(new Uint8Array([137, 80, 78, 71]), "image/png");
    const res = await get();
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(res.headers.get("cache-control")).toBe("private, max-age=86400");
  });
});

describe("AppIcon", () => {
  it("points at the proxy, not the remote URL", () => {
    const html = renderToStaticMarkup(createElement(AppIcon, { app: { id: "pp", name: "PP", icon: "https://pp.example/icon.png" } }));
    expect(html).toContain('src="/api/apps/pp/icon"');
    expect(html).not.toContain("pp.example");
  });
});
