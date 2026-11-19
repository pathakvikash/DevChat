import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    conversation: { updateMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    knowledgeBase: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn().mockResolvedValue("u1") }));
vi.mock("@/lib/claude/sessions", () => ({
  listProjects: vi.fn(async () => [{ cwd: "/home/owner/app" }]),
  listSessions: vi.fn(async () => []),
}));
vi.mock("@/lib/providerDetect", () => ({
  detectionAvailable: vi.fn(() => true),
  scanLocalCredentials: vi.fn(async () => ({ candidates: [], report: [] })),
}));
vi.mock("@/lib/models", () => ({ listModels: vi.fn(async () => ({ models: [], status: [] })) }));
vi.mock("@/lib/apiKeys", () => ({ resolveProviderCreds: vi.fn(async () => ({})) }));
vi.mock("@/lib/settings", () => ({
  getSettingsKey: vi.fn(async () => null),
  getSettingsKeys: vi.fn(async () => ({})),
  setSettingsKey: vi.fn(),
  deleteSettingsKey: vi.fn(),
  maskKey: vi.fn(),
}));
vi.mock("@/lib/cliProviders", () => ({ dropParkedRuns: vi.fn(), findCliBins: vi.fn(async () => new Set()) }));

import { prisma } from "@/lib/db";
import { resetHostAccessCache } from "@/lib/hostAccess";
import { scanLocalCredentials } from "@/lib/providerDetect";
import { listModels } from "@/lib/models";
import { listProjects } from "@/lib/claude/sessions";
import { PATCH } from "@/app/api/conversations/[id]/route";
import { POST as detect } from "@/app/api/providers/detect/route";
import { GET as sessions } from "@/app/api/claude-system/sessions/route";
import { GET as system } from "@/app/api/claude-system/route";
import { POST as systemFile } from "@/app/api/claude-system/file/route";
import { POST as claudeRun } from "@/app/api/claude-run/route";
import { DELETE as foldersDelete, GET as foldersGet, POST as foldersPost } from "@/app/api/folders/route";
import { GET as browse } from "@/app/api/folders/browse/route";
import { setSettingsKey } from "@/lib/settings";
import { GET as models } from "@/app/api/models/route";
import { GET as keys } from "@/app/api/settings/keys/route";

const db = prisma as any;
const saved = process.env.OWNER_EMAILS;
const json = (url: string, body: unknown) => new Request(url, { method: "POST", body: JSON.stringify(body) }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  resetHostAccessCache();
  process.env.OWNER_EMAILS = "owner@example.com";
  db.user.findUnique.mockResolvedValue({ email: "visitor@example.com" });
  db.conversation.updateMany.mockResolvedValue({ count: 1 });
  db.conversation.findUnique.mockResolvedValue({ id: "c1" });
});
afterEach(() => {
  if (saved === undefined) delete process.env.OWNER_EMAILS;
  else process.env.OWNER_EMAILS = saved;
});

const asOwner = () => db.user.findUnique.mockResolvedValue({ email: "Owner@example.com" });
const patch = (body: unknown) => PATCH(new Request("http://x/api/conversations/c1", { method: "PATCH", body: JSON.stringify(body) }) as any, { params: Promise.resolve({ id: "c1" }) });

describe("working folder", () => {
  it("is refused for a user who is not an owner, and nothing is saved", async () => {
    const res = await patch({ workingFolder: "/home/owner/app" });
    expect(res.status).toBe(403);
    expect(db.conversation.updateMany).not.toHaveBeenCalled();
  });

  it("is checked against the owner's folder list", async () => {
    asOwner();
    expect((await patch({ workingFolder: "/home/owner/app" })).status).toBe(200);
    expect((await patch({ workingFolder: "/etc" })).status).toBe(400);
  });

  it("PATCH with a Claude Code folder remembers it as added, and still succeeds when adding is refused", async () => {
    asOwner();
    const real = realpathSync(mkdtempSync(join(tmpdir(), "remember-")));
    try {
      vi.mocked(listProjects).mockResolvedValueOnce([{ cwd: real } as never]);
      expect((await patch({ workingFolder: real })).status).toBe(200);
      expect(setSettingsKey).toHaveBeenCalledWith("u1", "addedFolders", JSON.stringify([real]));
      vi.mocked(setSettingsKey).mockClear();
      // The default mocked project folder doesn't exist on disk, so adding it is refused (404) and the PATCH goes on.
      expect((await patch({ workingFolder: "/home/owner/app" })).status).toBe(200);
      expect(setSettingsKey).not.toHaveBeenCalled();
    } finally {
      rmSync(real, { recursive: true, force: true });
    }
  });

  it("can still be cleared, and other settings still saved, by a user who is not an owner", async () => {
    expect((await patch({ workingFolder: "", title: "x" })).status).toBe(200);
    expect(db.conversation.updateMany).toHaveBeenCalled();
  });
});

describe("routes that reach the server's machine", () => {
  const calls: Array<[string, () => Promise<Response>]> = [
    ["POST /api/providers/detect", () => detect(json("http://x/api/providers/detect", {}))],
    ["GET /api/claude-system/sessions", () => sessions(new Request("http://x/api/claude-system/sessions"))],
    ["GET /api/claude-system", () => system()],
    ["POST /api/claude-system/file", () => systemFile(json("http://x/api/claude-system/file", { path: "/home/owner/.claude/settings.json" }))],
    ["POST /api/claude-run", () => claudeRun(json("http://x/api/claude-run", { prompt: "id", cwd: "/home/owner/app" }))],
  ];

  for (const [name, call] of calls) {
    it(`${name} answers 403 for a user who is not an owner`, async () => {
      const res = await call();
      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/server's owner/);
    });
  }

  it("never scans the server's home directory for a user who is not an owner", async () => {
    await detect(json("http://x/api/providers/detect", {}));
    expect(scanLocalCredentials).not.toHaveBeenCalled();
    resetHostAccessCache();
    asOwner();
    expect((await detect(json("http://x/api/providers/detect", {}))).status).toBe(200);
    expect(scanLocalCredentials).toHaveBeenCalled();
  });

  it("lets an owner through to the sessions list", async () => {
    asOwner();
    expect((await sessions(new Request("http://x/api/claude-system/sessions"))).status).toBe(200);
  });
});

describe("folders API", () => {
  it("GET /api/folders gives a non-owner no folders and a reason", async () => {
    const body = await (await foldersGet()).json();
    expect(body).toMatchObject({ folders: [], hostTools: false });
    expect(body.reason).toMatch(/server's owner/);
  });

  it("browse and POST are 403 for a non-owner", async () => {
    expect((await foldersPost(json("http://x/api/folders", { path: "/tmp" }))).status).toBe(403);
    expect((await browse(new NextRequest("http://x/api/folders/browse"))).status).toBe(403);
  });
});

describe("folders API: other refusals", () => {
  it("DELETE is 403 for a non-owner", async () => {
    const req = new Request("http://x/api/folders", { method: "DELETE", body: JSON.stringify({ path: "/tmp" }) }) as any;
    expect((await foldersDelete(req)).status).toBe(403);
  });

  it("browse and POST are 403 on an open server (production without OWNER_EMAILS)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.OWNER_EMAILS;
    try {
      expect((await foldersPost(json("http://x/api/folders", { path: "/tmp" }))).status).toBe(403);
      expect((await browse(new NextRequest("http://x/api/folders/browse"))).status).toBe(403);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("claude-run refuses an owner's folder that is not on the list", async () => {
    asOwner();
    expect((await claudeRun(json("http://x/api/claude-run", { prompt: "id", cwd: "/etc" }))).status).toBe(403);
  });
});

describe("what the pickers are told", () => {
  it("asks for CLI models only for an owner", async () => {
    await models();
    expect(vi.mocked(listModels).mock.calls.at(-1)![1]).toBe(false);
    resetHostAccessCache();
    asOwner();
    await models();
    expect(vi.mocked(listModels).mock.calls.at(-1)![1]).toBe(true);
  });

  it("offers the machine scan only to an owner", async () => {
    expect((await (await keys()).json()).detectionAvailable).toBe(false);
    resetHostAccessCache();
    asOwner();
    expect((await (await keys()).json()).detectionAvailable).toBe(true);
  });
});
