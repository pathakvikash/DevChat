import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";

// HOME is a temp dir before the app loads, so the project list is empty and home is a known place.
const home = await vi.hoisted(async () => {
  const { mkdtempSync, realpathSync } = await import("fs");
  const { tmpdir } = await import("os");
  const { join } = await import("path");
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "folders-home-")));
  process.env.HOME = dir;
  return dir;
});

// Fake alias paths (a second name for one directory) for the dev+ino rule; the real filesystem can't make one in a temp dir.
const aliases = vi.hoisted(() => new Map<string, string>());
vi.mock("fs/promises", async (orig) => {
  const fs = await orig<typeof import("fs/promises")>();
  const target = (p: string) => {
    for (const [a, t] of aliases) if (p === a || p.startsWith(a + "/")) return t + p.slice(a.length);
    return p;
  };
  return {
    ...fs,
    default: fs,
    stat: (p: string) => fs.stat(target(p)),
    realpath: (p: string) => (aliases.size && target(p) !== p ? Promise.resolve(p) : fs.realpath(p)),
  };
});
vi.mock("@/lib/claude/sessions", async (orig) => {
  const real = await orig<typeof import("@/lib/claude/sessions")>();
  return { ...real, listProjects: vi.fn(real.listProjects) };
});

const store = new Map<string, string>();
vi.mock("@/lib/settings", () => ({
  getSettingsKey: vi.fn(async (_u: string, k: string) => store.get(k) ?? null),
  setSettingsKey: vi.fn(async (_u: string, k: string, v: string) => void store.set(k, v)),
}));
const canUseHostTools = vi.fn(async (_u: string) => true);
vi.mock("@/lib/hostAccess", () => ({
  canUseHostTools: (u: string) => canUseHostTools(u),
  HOST_TOOLS_REFUSED: "This is only available to the server's owner.",
}));

import { listProjects } from "@/lib/claude/sessions";
import { addFolder, allowedFolders, browseFolder, isAllowedFolder, removeFolder } from "@/lib/folders";

const U = "u1";
const FIXTURE = "/fixtures/sanity-folder";
const SANITY_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "development",
  SANITY_TEST_AUTH: "1",
  DATABASE_URL: "file:/repo/prisma/sanity.db",
  SANITY_WORKING_FOLDER: FIXTURE,
};
const saved = { ...process.env };
let proj: string;

beforeAll(() => {
  mkdirSync(join(home, ".claude", "projects"), { recursive: true });
  proj = join(home, "work", "proj");
  mkdirSync(proj, { recursive: true });
});
afterAll(() => rmSync(home, { recursive: true, force: true }));
beforeEach(() => {
  store.clear();
  aliases.clear();
  vi.mocked(listProjects).mockClear();
  canUseHostTools.mockResolvedValue(true);
});
afterEach(() => {
  aliases.clear();
  process.env = { ...saved };
});

const err = (r: { ok: boolean }) => r as unknown as { status: number; error: string };

describe("addFolder", () => {
  it("adds a folder and stores its realpath, following a symlink", async () => {
    const link = join(home, "work", "link");
    symlinkSync(proj, link);
    const r = await addFolder(U, link);
    expect(r).toMatchObject({ ok: true, path: proj, added: true });
    expect(JSON.parse(store.get("addedFolders")!)).toEqual([proj]);
    expect(await addFolder(U, "~/work/proj")).toMatchObject({ ok: true, path: proj });
  });

  it("refuses a relative path, a missing path and a file", async () => {
    expect(err(await addFolder(U, "work/proj")).status).toBe(400);
    expect(err(await addFolder(U, 5)).status).toBe(400);
    const missing = await addFolder(U, join(home, "nope"));
    expect(err(missing).status).toBe(404);
    expect(err(missing).error).toMatch(/^No folder at /);
    writeFileSync(join(home, "f.txt"), "x");
    expect(err(await addFolder(U, join(home, "f.txt"))).status).toBe(400);
  });

  it("refuses /, the home folder and a folder that contains home", async () => {
    expect(err(await addFolder(U, "/")).error).toMatch(/whole disk/);
    expect(err(await addFolder(U, home)).error).toMatch(/too broad/);
    if (existsSync("/Volumes")) expect(err(await addFolder(U, "/Volumes")).error).toMatch(/list of volumes/);
    expect(err(await addFolder(U, join(home, ".."))).error).toMatch(/contains your home folder/);
    expect(store.size).toBe(0);
  });

  it("refuses ~/.ssh, ~/.aws/x, ~/.claude, a symlink into ~/.ssh and a secrets folder", async () => {
    for (const d of [".ssh", ".aws/x", ".claude", "secrets"]) mkdirSync(join(home, d), { recursive: true });
    symlinkSync(join(home, ".ssh"), join(home, "work", "sshlink"));
    for (const p of [join(home, ".ssh"), join(home, ".aws", "x"), join(home, ".claude"), join(home, "work", "sshlink"), join(home, "secrets")]) {
      const r = await addFolder(U, p);
      expect(err(r).status).toBe(403);
      expect(err(r).error).toMatch(/keys or credentials/);
    }
  });

  it.runIf(existsSync("/System/Volumes/Data"))("refuses /System/Volumes paths (macOS aliases of the real tree)", async () => {
    for (const p of ["/System/Volumes/Data", `/System/Volumes/Data${home}`]) {
      const r = await addFolder(U, p);
      expect(err(r).status).toBe(403);
      expect(err(r).error).toMatch(/normal path/);
    }
  });

  it("refuses an alias of home or of a secret dir by device and inode, even for a child of it", async () => {
    mkdirSync(join(home, ".ssh", "sub"), { recursive: true });
    aliases.set("/alias/home", home);
    aliases.set("/alias/ssh", join(home, ".ssh"));
    expect(err(await addFolder(U, "/alias/home")).error).toMatch(/too broad/);
    expect(err(await addFolder(U, "/alias/ssh")).error).toMatch(/keys or credentials/);
    expect(err(await addFolder(U, "/alias/ssh/sub")).error).toMatch(/keys or credentials/);
    expect(store.size).toBe(0);
  });

  it("refuses a folder that contains a secret dir, but not a sibling like ~/Library/CloudStorage/x", async () => {
    mkdirSync(join(home, ".config", "gcloud"), { recursive: true });
    mkdirSync(join(home, "Library", "CloudStorage", "x"), { recursive: true });
    for (const p of [join(home, ".config"), join(home, "Library")]) {
      const r = await addFolder(U, p);
      expect(err(r).status).toBe(403);
      expect(err(r).error).toMatch(/contains folders with keys or credentials/);
    }
    expect(await addFolder(U, join(home, "Library", "CloudStorage", "x"))).toMatchObject({ ok: true });
  });

  it("refuses a folder holding a secret dir that is a symlink, but not a sibling", async () => {
    mkdirSync(join(home, "dotfiles", "config", "gh"), { recursive: true });
    mkdirSync(join(home, "dotfiles-other"));
    rmSync(join(home, ".config"), { recursive: true, force: true });
    symlinkSync(join(home, "dotfiles", "config"), join(home, ".config"));
    for (const p of [join(home, "dotfiles"), join(home, "dotfiles", "config"), join(home, ".config")]) {
      expect(err(await addFolder(U, p)).status).toBe(403);
    }
    expect(await addFolder(U, join(home, "dotfiles-other"))).toMatchObject({ ok: true });
    rmSync(join(home, ".config"));
  });

  it("refuses a non-owner (403) and production without OWNER_EMAILS", async () => {
    canUseHostTools.mockResolvedValue(false);
    expect(err(await addFolder(U, proj)).status).toBe(403);
    canUseHostTools.mockResolvedValue(true);
    process.env = { ...saved, NODE_ENV: "production", OWNER_EMAILS: "" };
    expect(err(await addFolder(U, proj)).error).toMatch(/OWNER_EMAILS/);
    expect(await allowedFolders(U)).toEqual([]);
  });

  it("adding twice is a no-op; the 101st folder is refused", async () => {
    await addFolder(U, proj);
    expect(await addFolder(U, proj)).toMatchObject({ ok: true, added: false });
    expect(JSON.parse(store.get("addedFolders")!)).toHaveLength(1);
    store.set("addedFolders", JSON.stringify(Array.from({ length: 100 }, (_, i) => `/x/${i}`)));
    expect(err(await addFolder(U, proj)).error).toMatch(/up to 100/);
  });
});

describe("allowedFolders / isAllowedFolder", () => {
  it("merges added and Claude Code folders; added wins on duplicates; sanity mode lists only its fixture", async () => {
    // A project transcript whose cwd is also an added folder.
    const slug = join(home, ".claude", "projects", "-p");
    mkdirSync(slug, { recursive: true });
    writeFileSync(join(slug, "s.jsonl"), JSON.stringify({ cwd: proj, type: "user" }) + "\n");
    const other = join(home, ".claude", "projects", "-q");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "s.jsonl"), JSON.stringify({ cwd: "/somewhere/else", type: "user" }) + "\n");
    await addFolder(U, proj);
    const list = await allowedFolders(U);
    expect(list).toContainEqual({ path: proj, source: "added" });
    expect(list.filter((f) => f.path === proj)).toHaveLength(1);
    expect(list).toContainEqual({ path: "/somewhere/else", source: "claude-code" });
    // The sanity suite must not see the machine's real Claude Code projects.
    process.env = { ...saved, ...SANITY_ENV };
    const inSanity = await allowedFolders(U);
    expect(inSanity).toContainEqual({ path: FIXTURE, source: "claude-code" });
    expect(inSanity.some((f) => f.path === "/somewhere/else")).toBe(false);
    rmSync(slug, { recursive: true });
    rmSync(other, { recursive: true });
  });

  it("isAllowedFolder is false after removal, and when an added folder becomes a symlink", async () => {
    await addFolder(U, proj);
    expect(await isAllowedFolder(U, proj)).toBe(true);
    expect(err(await removeFolder(U, "/not/added")).status).toBe(404);
    expect(await removeFolder(U, proj)).toMatchObject({ ok: true });
    expect(await isAllowedFolder(U, proj)).toBe(false);

    const swap = join(home, "work", "swap");
    mkdirSync(swap);
    await addFolder(U, swap);
    expect(await isAllowedFolder(U, swap)).toBe(true);
    rmSync(swap, { recursive: true });
    symlinkSync(proj, swap);
    expect(await isAllowedFolder(U, swap)).toBe(false);
  });

  it("is false when an added folder now matches a refuse rule, and never scans projects for an added folder", async () => {
    mkdirSync(join(home, ".config", "gcloud"), { recursive: true });
    store.set("addedFolders", JSON.stringify([proj, join(home, ".config")]));
    expect(await isAllowedFolder(U, proj)).toBe(true);
    expect(listProjects).not.toHaveBeenCalled();
    expect(await isAllowedFolder(U, join(home, ".config"))).toBe(false);
    expect(await isAllowedFolder(U, "/elsewhere")).toBe(false);
    expect(listProjects).toHaveBeenCalled();
  });

  it("is empty for a non-owner", async () => {
    await addFolder(U, proj);
    canUseHostTools.mockResolvedValue(false);
    expect(await allowedFolders(U)).toEqual([]);
    expect(await isAllowedFolder(U, proj)).toBe(false);
  });
});

describe("browseFolder", () => {
  it("lists only sub-folders, sorted, without hidden unless asked, capped at 500; / has no parent", async () => {
    const b = join(home, "browse");
    mkdirSync(b);
    for (const d of ["zeta", "alpha", ".hid", "secrets"]) mkdirSync(join(b, d));
    writeFileSync(join(b, "file.txt"), "x");
    symlinkSync(proj, join(b, "linked"));
    const r = await browseFolder(U, b, false);
    expect(r).toMatchObject({ ok: true, path: b, parent: home, truncated: false });
    expect((r as any).dirs.map((d: any) => d.name)).toEqual(["alpha", "zeta"]);
    expect(((await browseFolder(U, b, true)) as any).dirs.map((d: any) => d.name)).toEqual([".hid", "alpha", "zeta"]);

    const big = join(home, "big");
    mkdirSync(big);
    for (let i = 0; i < 501; i++) mkdirSync(join(big, `d${String(i).padStart(3, "0")}`));
    const capped = (await browseFolder(U, big, false)) as any;
    expect(capped.dirs).toHaveLength(500);
    expect(capped.truncated).toBe(true);

    mkdirSync(join(home, ".ssh"), { recursive: true });
    mkdirSync(join(home, ".claude"), { recursive: true });
    const hiddenHome = ((await browseFolder(U, home, true)) as any).dirs.map((d: any) => d.name);
    expect(hiddenHome).toContain("work");
    expect(hiddenHome).not.toContain(".ssh");
    expect(hiddenHome).not.toContain(".claude");

    expect(await browseFolder(U, "/", false)).toMatchObject({ ok: true, path: "/", parent: null });
    expect(err(await browseFolder(U, join(home, ".ssh"), false)).status).toBe(403);
  });

  it("starts at the fixtures folder in sanity mode, and at home otherwise", async () => {
    expect(await browseFolder(U, null, false)).toMatchObject({ ok: true, path: home });
    const fx = join(home, "fx");
    mkdirSync(join(fx, "project"), { recursive: true });
    process.env = { ...saved, ...SANITY_ENV, SANITY_WORKING_FOLDER: join(fx, "project") };
    expect(await browseFolder(U, null, false)).toMatchObject({ ok: true, path: fx });
  });
});

describe("the sanity folder", () => {
  const has = async () => (await allowedFolders(U)).some((f) => f.path === FIXTURE);

  it("is added while the sanity mode is on", async () => {
    process.env = { ...saved, ...SANITY_ENV };
    expect(await has()).toBe(true);
  });

  it("is ignored when the sanity test auth is off", async () => {
    process.env = { ...saved, ...SANITY_ENV, SANITY_TEST_AUTH: undefined };
    expect(await has()).toBe(false);
  });

  it("is ignored in production", async () => {
    process.env = { ...saved, ...SANITY_ENV, NODE_ENV: "production" };
    expect(await has()).toBe(false);
  });

  it("is ignored when the database is not the sanity file", async () => {
    process.env = { ...saved, ...SANITY_ENV, DATABASE_URL: "file:/repo/prisma/dev.db" };
    expect(await has()).toBe(false);
  });
});
