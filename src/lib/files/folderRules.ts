import { realpath, stat } from "fs/promises";
import { homedir } from "os";
import { dirname, isAbsolute, join, relative, sep } from "path";
import { isSecretPath } from "@/lib/files/safePath";

// Pure folder rules (no database): shared by the web app's folders.ts and the local bridge daemon.

const SECRET_HOME_DIRS = [
  ".ssh", ".aws", ".gnupg", ".claude", ".kube", ".docker", ".azure", ".password-store", ".config/gcloud", ".config/gh",
  "Library/Keychains", "Library/Cookies", "Library/Application Support",
];

export const short = (p: string) => (p.startsWith(homedir() + sep) ? "~" + p.slice(homedir().length) : p);

type Stat = { dev: number; ino: number };
const sameFile = (a: Stat, b: Stat) => a.dev === b.dev && a.ino === b.ino;
export type Secret = "inside" | "contains" | null;
/** Home and the secret home dirs, resolved once per call (a secret dir may itself be a symlink). */
type Ctx = { home: string; homeSt: Stat | null; secrets: { path: string; real: string | null; st: Stat | null }[] };

export async function loadCtx(): Promise<Ctx> {
  const home = await realpath(/*turbopackIgnore: true*/ homedir()).catch(() => homedir());
  const secrets = await Promise.all(
    SECRET_HOME_DIRS.map(async (d) => {
      const path = join(/*turbopackIgnore: true*/ home, d);
      return { path, real: await realpath(/*turbopackIgnore: true*/ path).catch(() => null), st: await stat(/*turbopackIgnore: true*/ path).catch(() => null) };
    }),
  );
  return { home, homeSt: await stat(/*turbopackIgnore: true*/ home).catch(() => null), secrets };
}

/** Whether `real` is, is inside, or contains a secret home dir; by name, by resolved path and by dev+ino so an alias can't dodge it.
 *  `ancestors: false` checks only `real` itself (for children of a folder already checked). */
export async function secretKind(real: string, ctx: Ctx, ancestors = true): Promise<Secret> {
  const { home, secrets } = ctx;
  const rel = relative(home, real);
  const inHome = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  if ((inHome && SECRET_HOME_DIRS.some((d) => rel === d || rel.startsWith(d + sep))) || isSecretPath(real)) return "inside";
  if (secrets.some((x) => x.real === real)) return "inside";
  if (secrets.some((x) => x.path.startsWith(real + sep) || x.real?.startsWith(real + sep))) return "contains";
  // ponytail: a bind-mount alias of a folder that CONTAINS home is not caught on Linux (only the folder's own ancestors are compared).
  for (let p = real; ; p = dirname(p)) {
    const st = await stat(/*turbopackIgnore: true*/ p).catch(() => null);
    if (st && secrets.some((x) => x.st && sameFile(x.st, st))) return "inside";
    if (!ancestors || p === dirname(p)) break;
  }
  return null;
}

export const SECRET_MSG = (real: string) => `${short(real)} holds keys or credentials, so it can't be a working folder.`;
const secretMsg = (real: string, k: Secret) =>
  k === "contains" ? `${short(real)} contains folders with keys or credentials. Pick a project folder inside it.` : SECRET_MSG(real);

/** Why this real path can't be a working folder, or null. */
export async function refuseReason(real: string): Promise<string | null> {
  const c = await loadCtx();
  const { home } = c;
  const name = short(real);
  if (real === "/") return "The whole disk can't be a working folder.";
  if (real === "/Volumes") return "Pick a folder on the volume, not the list of volumes.";
  if (real === "/System/Volumes" || real.startsWith("/System/Volumes/")) return "Pick the folder by its normal path (under /Users or /Volumes).";
  const st = await stat(/*turbopackIgnore: true*/ real).catch(() => null);
  if (real === home || (st && c.homeSt && sameFile(st, c.homeSt))) return "Your home folder is too broad. Pick a project folder inside it.";
  if (home.startsWith(real + sep)) return `${name} contains your home folder. Pick a project folder inside it.`;
  const k = await secretKind(real, c);
  return k ? secretMsg(real, k) : null;
}

