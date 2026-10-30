import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { execFileSync } from "child_process";
import { closeSync, constants, mkdirSync, mkdtempSync, openSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { NextRequest } from "next/server";

// HOME is a temp dir before the app loads, so the real isRunnableCwd reads a fixture ~/.claude/projects.
const home = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("fs");
  const { tmpdir } = await import("os");
  const { join } = await import("path");
  const dir = mkdtempSync(join(tmpdir(), "files-home-"));
  process.env.HOME = dir;
  return dir;
});

vi.mock("@/lib/db", () => ({ prisma: { conversation: { findUnique: vi.fn() } } }));
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn().mockResolvedValue("user-1") }));

import { prisma } from "@/lib/db";
import { GET } from "@/app/api/conversations/[id]/files/route";

const findUnique = vi.mocked(prisma.conversation.findUnique);
function setConversation(row: { userId: string; workingFolder: string | null } | null) {
  findUnique.mockResolvedValue(row as never);
}

let base: string;
let folder: string;
let other: string;

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "files-route-")));
  folder = join(base, "work");
  other = join(base, "not-a-project");
  mkdirSync(join(folder, "src"), { recursive: true });
  mkdirSync(other);
  mkdirSync(join(folder, ".git"));
  mkdirSync(join(folder, ".ssh"));
  mkdirSync(join(folder, ".github", "workflows"), { recursive: true });
  writeFileSync(join(folder, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(folder, "src", "big.txt"), Buffer.alloc(1024 * 1024 + 1, "a"));
  writeFileSync(join(folder, ".env.local"), "TOKEN=1\n");
  writeFileSync(join(folder, ".git", "config"), "[core]\n");
  writeFileSync(join(folder, ".ssh", "id"), "key\n");
  writeFileSync(join(folder, ".github", "workflows", "x.yml"), "on: push\n");
  writeFileSync(join(folder, "blob.bin"), Buffer.from([0x89, 0x50, 0x00, 0x47]));
  writeFileSync(join(base, "outside.txt"), "outside\n");
  symlinkSync(join(base, "outside.txt"), join(folder, "leak.txt"));
  symlinkSync(join(folder, ".env.local"), join(folder, "envlink"));
  symlinkSync(join(folder, ".ssh"), join(folder, "ssh-link"));
  mkdirSync(join(folder, "secrets"));
  writeFileSync(join(folder, "secrets", "prod.yaml"), "db_password: x\n");
  writeFileSync(join(folder, "terraform.tfvars"), "token = 1\n");
  execFileSync("mkfifo", [join(folder, "pipe")]);
  symlinkSync(join(folder, "pipe"), join(folder, "pipe-link"));

  // A Claude Code transcript whose cwd is `folder`: that is what makes it a project.
  const projectDir = join(home, ".claude", "projects", "-work");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, "session.jsonl"), JSON.stringify({ cwd: folder, gitBranch: "main" }) + "\n");
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  setConversation({ userId: "user-1", workingFolder: folder });
});

async function call(path?: string, id = "c1") {
  const q = path === undefined ? "" : `?path=${encodeURIComponent(path)}`;
  const req = new NextRequest(`http://localhost/api/conversations/${id}/files${q}`);
  const res = await GET(req, { params: Promise.resolve({ id }) });
  return { status: res.status, body: await res.json() };
}

describe("GET /api/conversations/[id]/files", () => {
  it("refuses a conversation that belongs to someone else (as if it did not exist)", async () => {
    setConversation({ userId: "user-2", workingFolder: folder });
    const { status, body } = await call("src/a.ts");
    expect(status).toBe(404);
    expect(body).not.toHaveProperty("content");
  });

  it("returns 404 for an unknown conversation", async () => {
    setConversation(null);
    expect((await call()).status).toBe(404);
  });

  it("needs a working folder", async () => {
    setConversation({ userId: "user-1", workingFolder: null });
    expect((await call()).status).toBe(400);
  });

  it("refuses a folder that is not one of the Claude Code projects (real isRunnableCwd)", async () => {
    setConversation({ userId: "user-1", workingFolder: other });
    expect((await call("src/a.ts")).status).toBe(400);
  });

  it("lists the folder without secret or hidden files", async () => {
    const { status, body } = await call();
    expect(status).toBe(200);
    const paths = body.files.map((f: { path: string }) => f.path);
    expect(paths).toContain("src/a.ts");
    expect(paths).toContain(".github/workflows/x.yml");
    expect(paths).not.toContain(".env.local");
    expect(paths).not.toContain(".git/config");
    expect(paths).not.toContain(".ssh/id");
  });

  it("reads a text file inside the folder", async () => {
    const { status, body } = await call("src/a.ts");
    expect(status).toBe(200);
    expect(body).toEqual({ path: "src/a.ts", content: "export const a = 1;\n" });
  });

  it("reads .github files but refuses .git, .ssh and symlinks into them", async () => {
    expect((await call(".github/workflows/x.yml")).status).toBe(200);
    expect((await call(".git/config")).status).toBe(403);
    expect((await call(".ssh/id")).status).toBe(403);
    expect((await call("ssh-link/id")).status).toBe(403);
  });

  it("refuses ../ and absolute paths outside the folder", async () => {
    expect((await call("../outside.txt")).status).toBe(403);
    expect((await call(join(folder, "..", "outside.txt"))).status).toBe(403);
  });

  it("refuses a symlink that points outside the folder", async () => {
    expect((await call("leak.txt")).status).toBe(403);
  });

  it("refuses .env.local, also when reached through a symlink", async () => {
    expect((await call(".env.local")).status).toBe(403);
    expect((await call("envlink")).status).toBe(403);
  });

  it("refuses secrets in a folder or by file name", async () => {
    expect((await call("secrets/prod.yaml")).status).toBe(403);
    expect((await call("terraform.tfvars")).status).toBe(403);
    const paths = (await call()).body.files.map((f: { path: string }) => f.path);
    expect(paths).not.toContain("secrets/prod.yaml");
    expect(paths).not.toContain("terraform.tfvars");
  });

  it("answers for a FIFO instead of blocking on it, also through a symlink", async () => {
    // Opening a FIFO for reading waits for a writer, so a request for one used to hang.
    const hung = Symbol("hung");
    for (const name of ["pipe", "pipe-link"]) {
      const result = await Promise.race([call(name), new Promise((r) => setTimeout(() => r(hung), 1500))]);
      // Release a blocked open so the test worker can exit even when the route is broken.
      try {
        closeSync(openSync(join(folder, "pipe"), constants.O_WRONLY | constants.O_NONBLOCK));
      } catch {}
      expect(result, name).not.toBe(hung);
      expect((result as { status: number }).status, name).toBe(404);
    }
  });

  it("refuses binary files", async () => {
    expect((await call("blob.bin")).status).toBe(415);
  });

  it("refuses a file over 1 MB without reading it whole", async () => {
    expect((await call("src/big.txt")).status).toBe(413);
  });
});
