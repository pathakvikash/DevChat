import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Real route + real registry; only the database and the auth/owner checks are mocked.
const h = vi.hoisted(() => ({ findMany: vi.fn(), requireUserId: vi.fn(), canUseHostTools: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { app: { findMany: h.findMany }, user: { findUnique: vi.fn().mockResolvedValue({ email: "me@x.co" }) } } }));
vi.mock("@/lib/auth", () => ({ requireUserId: h.requireUserId, UnauthorizedError: class UnauthorizedError extends Error {} }));
vi.mock("@/lib/hostAccess", () => ({ canUseHostTools: h.canUseHostTools }));

import { GET } from "@/app/api/apps/route";

const manifest = (id: string) => ({
  manifestVersion: 1, id, name: id, baseUrl: `https://${id}.example`, description: "d", goodFor: "g",
  mcp: { url: `https://${id}.example/api/mcp` }, auth: "orrery-jwt", capabilities: [], deepLinks: {}, permission: "read",
});
const row = (id: string, approved: boolean, toolsJson: string) => ({
  id, name: id, baseUrl: `https://${id}.example`, mcpUrl: `https://${id}.example/api/mcp`, manifestJson: JSON.stringify(manifest(id)),
  auth: "orrery-jwt", permission: "read", approved, toolsJson, status: "ok", toolsCachedAt: null, secretEnc: "SECRET-CIPHERTEXT", createdBy: "u1",
});
const get = (qs = "") => GET(new NextRequest(`http://localhost/api/apps${qs}`) as any);

beforeEach(() => {
  vi.clearAllMocks();
  h.requireUserId.mockResolvedValue("u1");
  h.canUseHostTools.mockResolvedValue(true);
  h.findMany.mockImplementation(async ({ where }: any) =>
    [row("empty", true, "[]"), row("broken", true, "not json"), row("tools", false, JSON.stringify([{ name: "t", description: "", inputSchema: {}, readOnly: true }]))].filter((r) => !where.approved || r.approved),
  );
});

describe("GET /api/apps", () => {
  it("owner with all=1 gets unapproved apps and a tools array on every record, never the secret", async () => {
    const { apps: body, owner } = await (await get("?all=1")).json();
    expect(owner).toBe(true);
    expect(body.map((a: any) => a.id)).toEqual(["empty", "broken", "tools"]);
    for (const a of body) expect(Array.isArray(a.tools)).toBe(true);
    expect(body[2]).toMatchObject({ approved: false, tools: [{ name: "t", readOnly: true }] });
    expect(JSON.stringify(body)).not.toMatch(/SECRET|secretEnc/);
  });

  it("owner without all=1 gets approved apps only (sidebar)", async () => {
    const body = await (await get()).json();
    expect(body.map((a: any) => a.id)).toEqual(["empty", "broken"]);
  });

  it("non-owner gets approved apps only, with no approved flag and no secret", async () => {
    h.canUseHostTools.mockResolvedValue(false);
    const { apps: body, owner } = await (await get("?all=1")).json();
    expect(owner).toBe(false); // the Settings page hides Add app from the first paint
    expect(body.map((a: any) => a.id)).toEqual(["empty", "broken"]);
    for (const a of body) {
      expect(a).not.toHaveProperty("approved");
      expect(a).not.toHaveProperty("tools");
    }
    expect(JSON.stringify(body)).not.toMatch(/SECRET|secretEnc/);
  });
});
