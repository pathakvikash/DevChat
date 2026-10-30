import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { isHiddenPath, isSecretPath, listFolderFiles, looksBinary, resolveInside } from "@/lib/files/safePath";

let base: string;
let folder: string;
let outside: string;

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "safe-path-")));
  folder = join(base, "work");
  outside = join(base, "outside");
  mkdirSync(join(folder, "inner"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(folder, "inner", "a.md"), "hi");
  writeFileSync(join(outside, "secret.txt"), "nope");
  mkdirSync(join(folder, ".git"));
  writeFileSync(join(folder, ".git", "config"), "[core]");
  mkdirSync(join(folder, ".ssh"));
  writeFileSync(join(folder, ".ssh", "id"), "key");
  mkdirSync(join(folder, ".github", "workflows"), { recursive: true });
  writeFileSync(join(folder, ".github", "workflows", "x.yml"), "on: push");
  symlinkSync(join(folder, ".ssh"), join(folder, "ssh-link"));
  symlinkSync(outside, join(folder, "linked-dir"));
  symlinkSync(join(outside, "secret.txt"), join(folder, "linked-file.txt"));
  symlinkSync(join(folder, "inner", "a.md"), join(folder, "inside-link.md"));
  mkdirSync(join(folder, "secrets"));
  writeFileSync(join(folder, "secrets", "prod.yaml"), "db_password: x");
  writeFileSync(join(folder, "terraform.tfvars"), "token = 1");
  symlinkSync(join(folder, "secrets", "prod.yaml"), join(folder, "plain-link.yaml"));
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("resolveInside", () => {
  it("accepts a nested file and a symlink that stays inside the folder", async () => {
    expect(await resolveInside(folder, "inner/a.md")).toBe(join(folder, "inner", "a.md"));
    expect(await resolveInside(folder, "inside-link.md")).toBe(join(folder, "inner", "a.md"));
  });

  it("refuses ../ out of the folder", async () => {
    expect(await resolveInside(folder, "../outside/secret.txt")).toBeNull();
    expect(await resolveInside(folder, "inner/../../outside/secret.txt")).toBeNull();
  });

  it("refuses an absolute path, even one that points inside the folder", async () => {
    expect(await resolveInside(folder, join(outside, "secret.txt"))).toBeNull();
    expect(await resolveInside(folder, join(folder, "inner", "a.md"))).toBeNull();
  });

  it("refuses a file symlink that points outside", async () => {
    expect(await resolveInside(folder, "linked-file.txt")).toBeNull();
  });

  it("refuses a file reached through a directory symlink that points outside", async () => {
    expect(await resolveInside(folder, "linked-dir/secret.txt")).toBeNull();
  });

  it("refuses dot-folders such as .git, .ssh and symlinks into them, but allows .github", async () => {
    expect(await resolveInside(folder, ".git/config")).toBeNull();
    expect(await resolveInside(folder, ".ssh/id")).toBeNull();
    expect(await resolveInside(folder, "ssh-link/id")).toBeNull();
    expect(await resolveInside(folder, ".github/workflows/x.yml")).toBe(join(folder, ".github", "workflows", "x.yml"));
  });

  it("refuses a secret path, also through a symlink with an innocent name", async () => {
    expect(await resolveInside(folder, "secrets/prod.yaml")).toBeNull();
    expect(await resolveInside(folder, "terraform.tfvars")).toBeNull();
    expect(await resolveInside(folder, "plain-link.yaml")).toBeNull();
  });

  it("does not mistake a folder that sits under a directory named secrets for a secret path", async () => {
    const proj = join(base, "my-secrets", "proj");
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, "ok.ts"), "");
    expect(await resolveInside(proj, "ok.ts")).toBe(join(proj, "ok.ts"));
  });

  it("refuses empty paths, NUL bytes and missing files", async () => {
    expect(await resolveInside(folder, "")).toBeNull();
    expect(await resolveInside(folder, "inner/a.md\0")).toBeNull();
    expect(await resolveInside(folder, "missing.md")).toBeNull();
  });
});

describe("isSecretPath", () => {
  it("flags env files, keys and credentials", () => {
    for (const p of [".env", ".env.local", "a/b.pem", "keys/server.key", "id_rsa", "config/credentials.json", ".npmrc", ".netrc", "secrets.yaml"]) {
      expect(isSecretPath(p), p).toBe(true);
    }
  });

  it("is case-insensitive and catches .envrc, production.env, ID_RSA, terraform.tfstate", () => {
    for (const p of [".envrc", "production.env", "ID_RSA", ".ENV", "terraform.tfstate", "CERT.PEM", "deploy.ppk", ".PGPASS"]) {
      expect(isSecretPath(p), p).toBe(true);
    }
  });

  it("flags a secret or credential in any folder name, not only the file name", () => {
    for (const p of ["secrets/prod.yaml", "config/Credentials/a.json", "a\\SECRETS\\b.txt", "x/my-secret-stash/deep/notes.txt"]) {
      expect(isSecretPath(p), p).toBe(true);
    }
  });

  it("flags terraform, kubeconfig, keystore, service-account and tool-credential files", () => {
    for (const p of [
      "terraform.tfvars", "prod.auto.tfvars.json", "infra/terraform.tfstate.backup", "terraform.tfstate.1700000000.backup",
      "kubeconfig", "ops/KubeConfig.yaml", "prod.kubeconfig", "kube-config",
      "app.jks", "release.keystore", "cert.p12", "cert.pfx",
      "serviceAccountKey.json", "service-account.json", "deploy-sa.json", "gcp-key.json", "gcpServiceKey.json",
      ".pypirc", ".netrc", ".npmrc",
    ]) {
      expect(isSecretPath(p), p).toBe(true);
    }
  });

  it("allows public keys and the .github folder", () => {
    expect(isSecretPath("id_rsa.pub")).toBe(false);
    expect(isSecretPath(".github/workflows/x.yml")).toBe(false);
    expect(isHiddenPath(".github/workflows/x.yml")).toBe(false);
    expect(isHiddenPath(".git/config")).toBe(true);
    expect(isHiddenPath(".aws/credentials")).toBe(true);
  });

  it("does not flag ordinary names", () => {
    for (const p of ["src/env.ts", "README.md", "src/app/api/chat/route.ts", "src/sa.ts", "docs/tfvars.md", "gcp/README.md", "package.json"]) {
      expect(isSecretPath(p), p).toBe(false);
    }
  });
});

describe("looksBinary", () => {
  it("treats a NUL byte in the first 8 KB as binary", () => {
    expect(looksBinary(Buffer.from([0x89, 0x50, 0x00, 0x01]))).toBe(true);
    expect(looksBinary(Buffer.from("plain text\n"))).toBe(false);
  });
});

describe("listFolderFiles", () => {
  it("walks the folder, skipping node_modules, dot-folders and secret files", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "list-walk-")));
    try {
      mkdirSync(join(dir, "node_modules"));
      mkdirSync(join(dir, ".hidden"));
      mkdirSync(join(dir, "sub"));
      writeFileSync(join(dir, "a.ts"), "");
      writeFileSync(join(dir, ".env.local"), "TOKEN=1");
      writeFileSync(join(dir, "node_modules", "x.js"), "");
      writeFileSync(join(dir, ".hidden", "z.txt"), "");
      writeFileSync(join(dir, "sub", "b.ts"), "");
      expect(await listFolderFiles(dir)).toEqual({
        files: [
          { path: "a.ts", size: 0 },
          { path: "sub/b.ts", size: 0 },
        ],
        truncated: false,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves out everything under a secrets folder and secret-named files in a walk", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "list-secret-")));
    try {
      mkdirSync(join(dir, "secrets"));
      writeFileSync(join(dir, "secrets", "prod.yaml"), "");
      writeFileSync(join(dir, "terraform.tfvars"), "");
      writeFileSync(join(dir, "serviceAccountKey.json"), "");
      writeFileSync(join(dir, "kubeconfig"), "");
      writeFileSync(join(dir, "ok.ts"), "");
      expect((await listFolderFiles(dir)).files.map((f) => f.path)).toEqual(["ok.ts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stops at the cap and says it was truncated", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "list-cap-")));
    try {
      for (const name of ["a.ts", "b.ts", "c.ts", "d.ts"]) writeFileSync(join(dir, name), "");
      const listed = await listFolderFiles(dir, 2);
      expect(listed.files.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
      expect(listed.truncated).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists only git-tracked files in a repo, with secrets still left out", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "list-git-")));
    try {
      execFileSync("git", ["init", "-q"], { cwd: dir });
      writeFileSync(join(dir, "tracked.ts"), "");
      writeFileSync(join(dir, "untracked.ts"), "");
      writeFileSync(join(dir, ".env"), "TOKEN=1");
      mkdirSync(join(dir, "secrets"));
      writeFileSync(join(dir, "secrets", "prod.yaml"), "");
      execFileSync("git", ["add", "-f", "tracked.ts", ".env", "secrets/prod.yaml"], { cwd: dir });
      expect(await listFolderFiles(dir)).toEqual({ files: [{ path: "tracked.ts", size: 0 }], truncated: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
