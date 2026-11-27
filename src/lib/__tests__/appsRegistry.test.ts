import { describe, it, expect, vi, beforeEach } from "vitest";
import { jwtVerify } from "jose";

process.env.AUTH_SECRET = "test-auth-secret";

const app = vi.hoisted(() => ({ findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { app } }));
const withMcpClient = vi.hoisted(() => vi.fn());
vi.mock("@/lib/mcp/client", () => ({ withMcpClient: (...a: unknown[]) => withMcpClient(...a) }));
const fetchManifest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/apps/manifest", () => ({ fetchManifest: (...a: unknown[]) => fetchManifest(...a) }));

import { callAppTool, listAppTools, previewApp, refreshApp, registerApp, shapeResult, MAX_TEXT_BYTES } from "@/lib/apps/registry";
import { ConflictError } from "@/lib/apps/types";
import { decryptValue, encryptValue } from "@/lib/settings";

const manifest = {
  manifestVersion: 1,
  id: "printpro3d",
  name: "Print Pro 3D",
  baseUrl: "https://pp.example.com",
  description: "d",
  goodFor: "g",
  mcp: { url: "https://pp.example.com/api/mcp" },
  auth: "orrery-jwt",
  capabilities: [],
  deepLinks: {},
  permission: "read",
};
const wireTools = [
  { name: "search", description: "s", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
  { name: "order", description: "o", inputSchema: { type: "object" } },
];
const cached = [
  { name: "search", description: "s", inputSchema: {}, readOnly: true },
  { name: "order", description: "o", inputSchema: {}, readOnly: false },
];
const SECRET = "app-secret-app-secret-app-secret";
const row = (over: Record<string, unknown> = {}) => ({
  id: "printpro3d",
  name: "Print Pro 3D",
  baseUrl: manifest.baseUrl,
  mcpUrl: manifest.mcp.url,
  manifestJson: JSON.stringify(manifest),
  auth: "orrery-jwt",
  permission: "read",
  approved: true,
  toolsJson: JSON.stringify(cached),
  status: "ok",
  toolsCachedAt: null,
  secretEnc: encryptValue(SECRET),
  createdBy: "u1",
  ...over,
});

/** Fake MCP: records the headers, answers listTools / callTool. */
function mcp(handlers: { list?: () => unknown; call?: (p: unknown) => unknown }) {
  withMcpClient.mockImplementation(async (_url: string, opts: { headers?: Record<string, string> }, fn: (c: unknown, r: unknown) => unknown) => {
    const client = {
      listTools: async () => {
        const r = handlers.list?.();
        if (r instanceof Error) throw r;
        return r;
      },
      callTool: async (p: unknown) => handlers.call?.(p),
    };
    mcp.lastHeaders = opts.headers;
    return fn(client, {});
  });
}
mcp.lastHeaders = undefined as Record<string, string> | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  app.update.mockImplementation(async ({ data }: any) => row(data));
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("previewApp", () => {
  it("maps readOnlyHint and warns when a read app has a mutating tool", async () => {
    fetchManifest.mockResolvedValue({ manifest, origin: manifest.baseUrl });
    mcp({ list: () => ({ tools: wireTools }) });
    const r = await previewApp("https://pp.example.com", "o@x.co");
    expect(r.tools.map((t) => [t.name, t.readOnly])).toEqual([["search", true], ["order", false]]);
    expect(r.warnings).toContain('permission is "read" but tool order is not marked read-only');
    expect(app.create).not.toHaveBeenCalled();
  });
});

describe("registerApp", () => {
  it("stores the secret encrypted and returns it once", async () => {
    fetchManifest.mockResolvedValue({ manifest, origin: manifest.baseUrl });
    app.findUnique.mockResolvedValue(null);
    app.create.mockImplementation(async ({ data }: any) => row(data));
    mcp({ list: () => ({ tools: wireTools }) });
    const r = await registerApp("https://pp.example.com", "u1", "o@x.co");
    const stored = app.create.mock.calls[0][0].data;
    expect(r.secret).toBeTruthy();
    expect(stored.secretEnc).not.toContain(r.secret!);
    expect(decryptValue(stored.secretEnc)).toBe(r.secret);
    expect(stored.approved).toBe(true);
    expect(JSON.stringify(r.app)).not.toContain(r.secret!);
  });

  it("keeps the existing secret on re-registration", async () => {
    fetchManifest.mockResolvedValue({ manifest, origin: manifest.baseUrl });
    app.findUnique.mockResolvedValue(row());
    mcp({ list: () => ({ tools: wireTools }) });
    const r = await registerApp("https://pp.example.com", "u1", "o@x.co");
    expect(r.secret).toBeNull();
    expect(app.create).not.toHaveBeenCalled();
  });
});

describe("registerApp origin change", () => {
  it("refuses a different origin for an existing id (409)", async () => {
    const other = { ...manifest, baseUrl: "https://evil.example.com", mcp: { url: "https://evil.example.com/api/mcp" } };
    fetchManifest.mockResolvedValue({ manifest: other, origin: other.baseUrl });
    app.findUnique.mockResolvedValue(row());
    await expect(registerApp("https://evil.example.com", "u1", "o@x.co")).rejects.toBeInstanceOf(ConflictError);
    expect(app.update).not.toHaveBeenCalled();
  });
});

describe("refreshApp", () => {
  it.each([
    ["auth", { auth: "none" }, "auth"],
    ["sso path", { sso: { path: "/sso" } }, "sso"],
    ["deep links", { deepLinks: { home: "/x" } }, "deepLinks"],
  ])("un-approves when %s changes", async (_n, over, key) => {
    app.findUnique.mockResolvedValue(row());
    mcp({ list: () => ({ tools: wireTools }) });
    fetchManifest.mockResolvedValue({ manifest: { ...manifest, ...over }, origin: manifest.baseUrl });
    const r = await refreshApp("printpro3d", "o@x.co");
    expect(r!.changed).toContain(key);
    expect(app.update.mock.calls[0][0].data.approved).toBe(false);
  });

  it("un-approves when the tool set changes", async () => {
    fetchManifest.mockResolvedValue({ manifest, origin: manifest.baseUrl });
    app.findUnique.mockResolvedValue(row());
    mcp({ list: () => ({ tools: [...wireTools, { name: "extra", inputSchema: {} }] }) });
    const r = await refreshApp("printpro3d", "o@x.co");
    expect(r!.changed).toEqual(["tools"]);
    expect(app.update.mock.calls[0][0].data.approved).toBe(false);
  });

  it("un-approves when permission changes and stays approved when nothing does", async () => {
    app.findUnique.mockResolvedValue(row());
    mcp({ list: () => ({ tools: wireTools }) });
    fetchManifest.mockResolvedValue({ manifest: { ...manifest, permission: "actions" }, origin: manifest.baseUrl });
    expect((await refreshApp("printpro3d", "o@x.co"))!.changed).toEqual(["permission"]);
    fetchManifest.mockResolvedValue({ manifest, origin: manifest.baseUrl });
    app.update.mockClear();
    expect((await refreshApp("printpro3d", "o@x.co"))!.changed).toEqual([]);
    expect(app.update.mock.calls[0][0].data.approved).toBeUndefined();
  });
});

describe("listAppTools", () => {
  it("falls back to the cached list and marks the app unreachable", async () => {
    app.findUnique.mockResolvedValue(row());
    mcp({ list: () => new Error("ECONNREFUSED") });
    const tools = await listAppTools("u1", "a@b.co", "printpro3d");
    expect(tools).toEqual(cached);
    expect(app.update.mock.calls[0][0].data).toEqual({ status: "unreachable" });
  });
});

describe("callAppTool", () => {
  it("signs a per-call token for the user and returns text plus validated structured content", async () => {
    app.findUnique.mockResolvedValue(row());
    const structured = { orrery: 1, type: "table", columns: ["a"], rows: [[1]] };
    mcp({ call: () => ({ content: [{ type: "text", text: "one" }, { type: "text", text: "two" }], structuredContent: structured }) });
    const r = await callAppTool("u1", "a@b.co", "printpro3d", "search", { q: 1 });
    expect(r).toEqual({ text: "one\ntwo", structured });
    const { payload } = await jwtVerify(mcp.lastHeaders!.Authorization.replace("Bearer ", ""), new TextEncoder().encode(SECRET), { audience: "printpro3d", issuer: "orrery" });
    expect(payload.sub).toBe("a@b.co");
    const log = JSON.parse((console.info as any).mock.calls[0][0]);
    expect(log).toMatchObject({ userId: "u1", appId: "printpro3d", tool: "search", ok: true });
    expect(typeof log.ms).toBe("number");
  });

  it("drops invalid structured content but keeps the text", async () => {
    app.findUnique.mockResolvedValue(row());
    mcp({ call: () => ({ content: [{ type: "text", text: "hi" }], structuredContent: { type: "nope" } }) });
    expect(await callAppTool("u1", "a@b.co", "printpro3d", "search", {})).toEqual({ text: "hi" });
    expect(console.warn).toHaveBeenCalled();
  });

  it("refuses unapproved apps, unknown tools and mutating tools of a read app, and still logs", async () => {
    app.findUnique.mockResolvedValue(row({ approved: false }));
    await expect(callAppTool("u1", "a@b.co", "printpro3d", "search", {})).rejects.toThrow(/not available/);
    app.findUnique.mockResolvedValue(row());
    await expect(callAppTool("u1", "a@b.co", "printpro3d", "ghost", {})).rejects.toThrow(/no tool/);
    await expect(callAppTool("u1", "a@b.co", "printpro3d", "order", {})).rejects.toThrow(/read permission/);
    expect(withMcpClient).not.toHaveBeenCalled();
    expect(JSON.parse((console.info as any).mock.calls[2][0]).ok).toBe(false);
  });

  it("sends no Authorization header for auth none", async () => {
    app.findUnique.mockResolvedValue(row({ manifestJson: JSON.stringify({ ...manifest, auth: "none" }) }));
    mcp({ call: () => ({ content: [] }) });
    await callAppTool("u1", "a@b.co", "printpro3d", "search", {});
    expect(mcp.lastHeaders).toEqual({});
  });

  it("parses a job status for the jobs route", async () => {
    app.findUnique.mockResolvedValue(row());
    mcp({ call: () => ({ content: [], structuredContent: { state: "running", progress: 40 } }) });
    expect((await callAppTool("u1", "a@b.co", "printpro3d", "search", {}, { job: true })).job).toEqual({ state: "running", progress: 40 });
  });
});

describe("shapeResult caps", () => {
  it("truncates text at 256 KB and drops structured content over 1 MB", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const big = shapeResult("a", "t", {
      content: [{ type: "text", text: "x".repeat(MAX_TEXT_BYTES + 10) }],
      structuredContent: { orrery: 1, type: "table", columns: ["a"], rows: [["y".repeat(1024 * 1024 + 1)]] },
    });
    expect(Buffer.byteLength(big.text)).toBeLessThan(MAX_TEXT_BYTES + 50);
    expect(big.text).toContain("[truncated");
    expect(big.structured).toBeUndefined();
  });
});
