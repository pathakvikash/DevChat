import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique: vi.fn() } } }));
vi.mock("@/lib/cliProviders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cliProviders")>()),
  findCliBins: vi.fn(async () => new Set<string>()),
  listCliModels: vi.fn(async () => ({
    entries: [{ id: "claude-code/sonnet", name: "Sonnet", provider: "Claude Code", contextWindow: 200000, model: {} }],
    status: [],
  })),
}));

import { prisma } from "@/lib/db";
import { findCliBins } from "@/lib/cliProviders";
import { canUseHostTools, hostToolsHere, hostToolsReason, HOST_TOOLS_REFUSED, FOLDER_TEMPLATE_REFUSED, resetHostAccessCache } from "@/lib/hostAccess";
import { getModel, listModels } from "@/lib/models";

const find = vi.mocked((prisma as any).user.findUnique);
const saved = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  resetHostAccessCache();
  delete process.env.OWNER_EMAILS;
});
afterEach(() => {
  process.env = { ...saved };
  vi.useRealTimers();
});

describe("canUseHostTools", () => {
  it("lets everyone in when OWNER_EMAILS is unset or blank, without a database lookup", async () => {
    expect(await canUseHostTools("u1")).toBe(true);
    process.env.OWNER_EMAILS = "  ";
    expect(await canUseHostTools("u1")).toBe(true);
    expect(find).not.toHaveBeenCalled();
  });

  it("lets in only the listed emails, trimmed and case-insensitive", async () => {
    process.env.OWNER_EMAILS = " Owner@Example.com ,second@example.com,";
    find.mockImplementation(async ({ where }: any) => ({ email: { u1: "OWNER@example.COM", u2: "second@example.com", u3: "intruder@example.com", u4: null }[where.id as string] ?? null }));
    expect(await canUseHostTools("u1")).toBe(true);
    expect(await canUseHostTools("u2")).toBe(true);
    expect(await canUseHostTools("u3")).toBe(false);
    expect(await canUseHostTools("u4")).toBe(false);
    expect(await canUseHostTools("gone")).toBe(false);
  });

  it("looks a user up once per half minute", async () => {
    vi.useFakeTimers();
    process.env.OWNER_EMAILS = "owner@example.com";
    find.mockResolvedValue({ email: "owner@example.com" });
    await canUseHostTools("u1");
    await canUseHostTools("u1");
    expect(find).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(31_000);
    find.mockResolvedValue({ email: "other@example.com" });
    expect(await canUseHostTools("u1")).toBe(false);
    expect(find).toHaveBeenCalledTimes(2);
  });

  it("warns once, only in a production build, when OWNER_EMAILS is unset", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await canUseHostTools("u1");
    expect(warn).not.toHaveBeenCalled();
    process.env = { ...process.env, NODE_ENV: "production" };
    await canUseHostTools("u1");
    await canUseHostTools("u2");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/OWNER_EMAILS/);
    warn.mockRestore();
  });
});

describe("getModel for CLI models", () => {
  it("refuses a CLI model without host access, even where CLI models are available", () => {
    process.env.ALLOW_PROVIDER_DETECTION = "1";
    expect(() => getModel("claude-code/sonnet")).toThrow(/server's owner/);
    expect(() => getModel("claude-code/sonnet", {}, false)).toThrow(/server's owner/);
    expect(getModel("claude-code/sonnet", {}, true).id).toBe("claude-code/sonnet");
  });
});

describe("listModels for CLI models", () => {
  it("lists them only for a user with host access", async () => {
    process.env.ALLOW_PROVIDER_DETECTION = "1";
    const ids = async (hostTools?: boolean) => (await listModels({}, hostTools)).models.map((m) => m.id);
    expect(await ids()).not.toContain("claude-code/sonnet");
    expect(await ids(false)).not.toContain("claude-code/sonnet");
    expect(await ids(true)).toContain("claude-code/sonnet");
  });
});

describe("hostToolsHere", () => {
  it("needs Claude Code or OpenCode installed, not just permission", async () => {
    expect(await hostToolsHere("u1")).toBe(false);
    vi.mocked(findCliBins).mockResolvedValueOnce(new Set(["codex"]));
    expect(await hostToolsHere("u1")).toBe(false);
    vi.mocked(findCliBins).mockResolvedValueOnce(new Set(["opencode"]));
    expect(await hostToolsHere("u1")).toBe(true);
  });
});

describe("hostToolsReason", () => {
  it("says owner-only to a non-owner, and the missing CLI only to an owner", async () => {
    process.env.OWNER_EMAILS = "owner@example.com";
    find.mockImplementation(async ({ where }: any) => ({ email: where.id === "o" ? "owner@example.com" : "x@example.com" }));
    expect(await hostToolsReason("x")).toBe(HOST_TOOLS_REFUSED);
    expect(await hostToolsReason("o")).toBe(FOLDER_TEMPLATE_REFUSED);
    vi.mocked(findCliBins).mockResolvedValueOnce(new Set(["claude-code"]));
    expect(await hostToolsReason("o")).toBeNull();
  });
});
