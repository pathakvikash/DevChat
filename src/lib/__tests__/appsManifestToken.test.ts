import { describe, it, expect, vi, beforeEach } from "vitest";
import { jwtVerify } from "jose";

vi.mock("@/lib/net/safeFetch", () => ({ safeFetch: vi.fn() }));
import { safeFetch } from "@/lib/net/safeFetch";
import { fetchManifest } from "@/lib/apps/manifest";
import { signAppToken, signHandoffToken } from "@/lib/apps/token";

const mock = safeFetch as unknown as ReturnType<typeof vi.fn>;
const good = {
  manifestVersion: 1,
  id: "printpro3d",
  name: "Print Pro 3D",
  icon: "https://pp.example.com/icon.svg",
  baseUrl: "https://pp.example.com",
  description: "d",
  goodFor: "g",
  mcp: { url: "https://pp.example.com/api/mcp" },
  auth: "orrery-jwt",
  sso: { path: "/sso" },
  capabilities: ["job"],
  deepLinks: { quote: "/quote?file={file}" },
  permission: "read",
};
const reply = (m: unknown, over: Record<string, unknown> = {}) =>
  mock.mockResolvedValue({ ok: true, status: 200, url: "https://pp.example.com/.well-known/orrery-app.json", contentType: "application/json", text: JSON.stringify(m), ...over });

beforeEach(() => { mock.mockReset(); });

describe("fetchManifest", () => {
  it("fetches the well-known path from a base URL", async () => {
    reply(good);
    const { manifest, origin } = await fetchManifest("https://pp.example.com");
    expect(manifest.id).toBe("printpro3d");
    expect(origin).toBe("https://pp.example.com");
    expect(mock.mock.calls[0][0]).toBe("https://pp.example.com/.well-known/orrery-app.json");
    expect(mock.mock.calls[0][1]).toMatchObject({ maxBytes: 64 * 1024, timeoutMs: 5000 });
  });

  it("refuses http outside localhost", async () => {
    await expect(fetchManifest("http://pp.example.com")).rejects.toThrow(/https/);
  });

  it.each([
    ["baseUrl", { baseUrl: "https://evil.example.com" }],
    ["mcp.url", { mcp: { url: "https://evil.example.com/mcp" } }],
    ["icon", { icon: "https://evil.example.com/i.svg" }],
    ["sso.path", { sso: { path: "//evil.example.com/x" } }],
    ["deepLinks", { deepLinks: { q: "//evil.example.com/x" } }],
  ])("pins %s to the manifest origin", async (_n, patch) => {
    reply({ ...good, ...patch });
    await expect(fetchManifest("https://pp.example.com")).rejects.toThrow();
  });

  it("rejects an unknown manifestVersion", async () => {
    reply({ ...good, manifestVersion: 2 });
    await expect(fetchManifest("https://pp.example.com")).rejects.toThrow(/manifestVersion/);
  });

  it("rejects a redirect to another origin and bad JSON", async () => {
    reply(good, { url: "https://evil.example.com/x" });
    await expect(fetchManifest("https://pp.example.com")).rejects.toThrow(/redirected/);
    reply(good, { text: "nope" });
    await expect(fetchManifest("https://pp.example.com")).rejects.toThrow(/JSON/);
  });

  it("reports an oversize body", async () => {
    mock.mockRejectedValue(new Error("Response is over 0 MB"));
    await expect(fetchManifest("https://pp.example.com")).rejects.toThrow(/64 KB/);
  });
});

describe("tokens", () => {
  const o = { appId: "printpro3d", email: "a@b.co", secret: "s3cret-s3cret-s3cret-s3cret" };
  const key = new TextEncoder().encode(o.secret);

  it("signs a 60 s service token", async () => {
    const { payload } = await jwtVerify(await signAppToken(o), key, { issuer: "orrery", audience: "printpro3d" });
    expect(payload.sub).toBe("a@b.co");
    expect(payload.exp! - payload.iat!).toBe(60);
    expect(payload.jti).toBeTruthy();
    expect(payload.purpose).toBeUndefined();
  });

  it("signs a handoff token with the sso purpose and unique jti", async () => {
    const a = await jwtVerify(await signHandoffToken(o), key, { audience: "printpro3d" });
    const b = await jwtVerify(await signHandoffToken(o), key, { audience: "printpro3d" });
    expect(a.payload).toMatchObject({ typ: "sso", purpose: "sso" });
    expect(a.payload.exp! - a.payload.iat!).toBe(60);
    expect(a.payload.jti).not.toBe(b.payload.jti);
  });

  it("is rejected with the wrong secret", async () => {
    await expect(jwtVerify(await signAppToken(o), new TextEncoder().encode("x".repeat(32)))).rejects.toThrow();
  });
});
