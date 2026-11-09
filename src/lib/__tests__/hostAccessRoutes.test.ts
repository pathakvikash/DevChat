import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    conversation: { updateMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    knowledgeBase: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn().mockResolvedValue("u1") }));
vi.mock("@/lib/claude/sessions", () => ({
  isRunnableCwd: vi.fn(async () => true),
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
import { PATCH } from "@/app/api/conversations/[id]/route";
import { POST as detect } from "@/app/api/providers/detect/route";
import { GET as sessions } from "@/app/api/claude-system/sessions/route";
import { GET as system } from "@/app/api/claude-system/route";
import { POST as systemFile } from "@/app/api/claude-system/file/route";
import { POST as claudeRun } from "@/app/api/claude-run/route";
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

  it("is checked against Claude Code's folders for an owner", async () => {
    asOwner();
    expect((await patch({ workingFolder: "/home/owner/app" })).status).toBe(200);
    const { isRunnableCwd } = await import("@/lib/claude/sessions");
    vi.mocked(isRunnableCwd).mockResolvedValueOnce(false);
    expect((await patch({ workingFolder: "/etc" })).status).toBe(400);
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
