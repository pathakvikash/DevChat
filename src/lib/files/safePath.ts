import { execFile } from "child_process";
import { existsSync } from "fs";
import { lstat, readdir, realpath } from "fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "path";
import { promisify } from "util";

const run = promisify(execFile);

/** Files the picker lists at most; the walk stops here. */
export const LIST_CAP = 5000;

const SECRET_NAMES = [
  /^\.env/i, // .env, .env.local, .envrc
  /\.env$/i, // production.env
  /^id_/i, // id_rsa, ID_ED25519 (public keys are excluded below)
  /\.(pem|key|p12|pfx|keystore|tfstate|ppk)$/i,
  /^\.(npmrc|netrc|pgpass)$/i,
  /credential|secret/i,
];

/** Names of files that must never reach a model: env files, keys, state and credentials. */
export function isSecretPath(rel: string): boolean {
  const name = basename(rel);
  if (/^id_.*\.pub$/i.test(name)) return false;
  return SECRET_NAMES.some((pattern) => pattern.test(name));
}

/** True when any segment is a dot-name (`.git`, `.ssh`, `.aws`, `.env`), except `.github`. */
export function isHiddenPath(rel: string): boolean {
  return rel.split(/[\\/]/).some((seg) => seg.startsWith(".") && seg !== "." && seg !== ".github");
}

/** A NUL byte in the first 8 KB means binary. */
export function looksBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8192).includes(0);
}

/**
 * The real path of `rel` inside `folder`, or null when it is outside, hidden, missing or not
 * reachable. Symlinks are followed first, so a link into a hidden folder is refused too.
 */
export async function resolveInside(folder: string, rel: string): Promise<string | null> {
  if (!rel || isAbsolute(rel) || rel.includes("\0") || isHiddenPath(rel)) return null;
  try {
    const root = await realpath(folder);
    const target = await realpath(resolve(root, rel));
    if (!target.startsWith(root + sep)) return null;
    return isHiddenPath(relative(root, target)) ? null : target;
  } catch {
    return null;
  }
}

/** Files under `folder` with their sizes (git-tracked when it is a repo, else a capped walk). Secret and hidden paths are left out. */
export async function listFolderFiles(
  folder: string,
  cap = LIST_CAP,
): Promise<{ files: { path: string; size: number }[]; truncated: boolean }> {
  const tracked = existsSync(join(folder, ".git")) ? await gitFiles(folder) : null;
  const paths = (tracked ?? (await walkFiles(folder, cap + 1))).filter((rel) => !isSecretPath(rel) && !isHiddenPath(rel));
  const files = await Promise.all(
    paths.slice(0, cap).map(async (path) => ({ path, size: (await lstat(join(folder, path)).catch(() => null))?.size ?? 0 })),
  );
  return { files, truncated: paths.length > cap };
}

async function gitFiles(folder: string): Promise<string[] | null> {
  try {
    const { stdout } = await run("git", ["ls-files", "-z"], { cwd: folder, maxBuffer: 64 * 1024 * 1024 });
    return stdout.split("\0").filter(Boolean);
  } catch {
    return null;
  }
}

// Symlinks are not followed, so the walk cannot leave the folder.
async function walkFiles(folder: string, limit: number): Promise<string[]> {
  const out: string[] = [];
  const dirs = [""];
  while (dirs.length > 0 && out.length < limit) {
    const dir = dirs.shift()!;
    const entries = await readdir(join(folder, dir), { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && (!entry.name.startsWith(".") || entry.name === ".github")) dirs.push(rel);
      } else if (entry.isFile() && !isSecretPath(rel) && out.length < limit) {
        out.push(rel);
      }
    }
  }
  return out;
}
