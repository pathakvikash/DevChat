import { execFile } from "child_process";
import { constants, existsSync } from "fs";
import { lstat, open, readdir, realpath, stat } from "fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "path";
import { promisify } from "util";

const run = promisify(execFile);

/** Files the picker lists at most; the walk stops here. */
export const LIST_CAP = 5000;

// Tested against every segment, so a `secrets/` or `credentials/` folder hides all it holds,
// except source and docs: a `secrets/` module's code or a credentials guide is not a secret.
const SECRET_SEGMENT = /secret|credential|kube[-_]?config/i;
const CODE_OR_DOC = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|swift|c|h|cpp|md|mdx|rst|html|css|scss)$/i;

// Tested against the file name only.
const SECRET_NAMES = [
  /^\.env/i, // .env, .env.local, .envrc
  /\.env$/i, // production.env
  /^id_/i, // id_rsa, ID_ED25519 (public keys are excluded below)
  /\.(pem|key|p12|pfx|jks|keystore|ppk)$/i,
  /\.tfvars(\.json)?$/i, // terraform.tfvars, prod.auto.tfvars.json
  /\.tfstate(\.|$)/i, // terraform.tfstate, .tfstate.backup, .tfstate.1234.backup
  /^\.(npmrc|netrc|pypirc|pgpass)$/i,
  /^service[-_]?account.*\.json$/i, // serviceAccountKey.json, service-account.json
  /[-_.]sa\.json$/i, // deploy-sa.json
  /^gcp.*key.*\.json$/i, // gcp-key.json, gcpServiceKey.json
];

/** Paths that must never reach a model: env files, keys, state and credentials, by file name or any folder name. */
export function isSecretPath(rel: string): boolean {
  const segments = rel.split(/[\\/]/).filter(Boolean);
  const name = segments[segments.length - 1] ?? "";
  if (/^id_.*\.pub$/i.test(name)) return false;
  if (SECRET_NAMES.some((pattern) => pattern.test(name))) return true;
  return !CODE_OR_DOC.test(name) && segments.some((seg) => SECRET_SEGMENT.test(seg));
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
 * The real path of `rel` inside `folder`, or null when it is outside, hidden, secret, missing or
 * not reachable. Symlinks are followed first, so a link into a hidden or secret folder is refused too.
 */
export async function resolveInside(folder: string, rel: string): Promise<string | null> {
  if (!rel || isAbsolute(rel) || rel.includes("\0") || isHiddenPath(rel) || isSecretPath(rel)) return null;
  try {
    const root = await realpath(folder);
    const target = await realpath(resolve(root, rel));
    if (!target.startsWith(root + sep)) return null;
    const inside = relative(root, target);
    return isHiddenPath(inside) || isSecretPath(inside) ? null : target;
  } catch {
    return null;
  }
}

export type ReadInside =
  | { ok: true; text: string; real: string }
  | { ok: false; reason: "refused" | "missing" | "too-large" | "binary" };

/** The text of one file inside `folder` (at most `maxBytes`), reached only through resolveInside. */
export async function readInside(folder: string, rel: string, maxBytes = 1024 * 1024): Promise<ReadInside> {
  const real = await resolveInside(folder, rel);
  if (!real) return { ok: false, reason: "refused" };
  // Opening a FIFO for reading blocks until a writer shows up, so only a regular file is opened.
  // O_NONBLOCK covers a swap after the stat; the handle is checked again below.
  // O_NOFOLLOW plus the same dev/inode refuses a swap for a symlink or another file between the checks and the open.
  const checked = await stat(real).catch(() => null);
  if (!checked?.isFile()) return { ok: false, reason: "missing" };
  const handle = await open(real, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW).catch(() => null);
  if (!handle) return { ok: false, reason: "missing" };
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.ino !== checked.ino || opened.dev !== checked.dev) return { ok: false, reason: "missing" };
    // O_NOFOLLOW covers only the last component: a parent swapped for a symlink after the checks must not be followed.
    if ((await realpath(real).catch(() => null)) !== real) return { ok: false, reason: "refused" };
    // And the path must still lead to the handle we hold: a swap back between the open and the check would pass the line above.
    const now = await stat(real).catch(() => null);
    if (!now || now.ino !== opened.ino || now.dev !== opened.dev) return { ok: false, reason: "missing" };
    // One read of at most the cap plus one byte, so a file that grows after a stat is still bounded.
    const buf = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    if (bytesRead > maxBytes) return { ok: false, reason: "too-large" };
    const data = buf.subarray(0, bytesRead);
    if (looksBinary(data)) return { ok: false, reason: "binary" };
    return { ok: true, text: data.toString("utf8"), real };
  } finally {
    await handle.close();
  }
}

/**
 * Files under `folder` with their sizes (git-tracked when it is a repo, else a capped walk). Secret and hidden paths are left out.
 * `sub` (a path relative to `folder`, already checked by resolveInside) limits the listing to that subfolder before the cap applies.
 */
export async function listFolderFiles(
  folder: string,
  cap = LIST_CAP,
  sub = "",
): Promise<{ files: { path: string; size: number }[]; truncated: boolean }> {
  const tracked = existsSync(join(folder, ".git")) ? await gitFiles(folder, sub) : null;
  const paths = (tracked ?? (await walkFiles(folder, cap + 1, sub))).filter((rel) => !isSecretPath(rel) && !isHiddenPath(rel));
  const files = await Promise.all(
    paths.slice(0, cap).map(async (path) => ({ path, size: (await lstat(join(folder, path)).catch(() => null))?.size ?? 0 })),
  );
  return { files, truncated: paths.length > cap };
}

async function gitFiles(folder: string, sub: string): Promise<string[] | null> {
  try {
    // Literal pathspecs: a folder named like a glob or ":(magic)" is just a name.
    const args = ["--literal-pathspecs", "ls-files", "-z", ...(sub ? ["--", sub] : [])];
    const { stdout } = await run("git", args, { cwd: folder, maxBuffer: 64 * 1024 * 1024 });
    return stdout.split("\0").filter(Boolean);
  } catch {
    return null;
  }
}

// Symlinks are not followed, so the walk cannot leave the folder.
async function walkFiles(folder: string, limit: number, sub: string): Promise<string[]> {
  const out: string[] = [];
  const dirs = [sub];
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
