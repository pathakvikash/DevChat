import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ detect: vi.fn(() => true) }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/settings", () => ({ getSettingsKey: vi.fn(), setSettingsKey: vi.fn() }));
vi.mock("@/lib/claude/sessions", () => ({ listProjects: vi.fn(async () => []) }));
vi.mock("@/lib/hostAccess", async () => ({ canUseHostTools: vi.fn(async () => true), HOST_TOOLS_REFUSED: "This is only available to the server's owner." }));
vi.mock("@/lib/providerDetect", () => ({ detectionAvailable: h.detect }));

import { folderAccess, folderAccessForPage } from "@/lib/folders";
import { serverHostToolsMissing } from "@/lib/bridge/client";
import { SERVER_NO_CLI, VERCEL_FOLDERS_REFUSED } from "@/lib/bridge/constants";

const saved = { vercel: process.env.VERCEL };
beforeEach(() => {
  delete process.env.VERCEL;
  h.detect.mockReturnValue(true);
});
afterEach(() => {
  if (saved.vercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = saved.vercel;
});

describe("folderAccess reports when this server cannot run CLIs", () => {
  it("local development (detection on) is unchanged: no reason", async () => {
    expect(await folderAccessForPage("u")).toEqual({ hostTools: true, reason: null });
  });
  it("a self-hosted server without CLI detection says so, which routes claude-code models to the bridge", async () => {
    h.detect.mockReturnValue(false);
    const a = await folderAccessForPage("u");
    expect(a).toEqual({ hostTools: true, reason: SERVER_NO_CLI });
    expect(serverHostToolsMissing(a)).toBe(true);
    // Adding folders is still decided by folderAccess, which is unchanged.
    expect(await folderAccess("u")).toEqual({ hostTools: true, reason: null });
  });
  it("Vercel keeps its own reason", async () => {
    process.env.VERCEL = "1";
    h.detect.mockReturnValue(false);
    expect((await folderAccessForPage("u")).reason).toBe(VERCEL_FOLDERS_REFUSED);
  });
});
