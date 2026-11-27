import { readdir, realpath, stat } from "fs/promises";
import { homedir } from "os";
import { dirname, isAbsolute, join } from "path";
import { listProjects } from "@/lib/claude/sessions";
import { canUseHostTools, HOST_TOOLS_REFUSED } from "@/lib/hostAccess";
import { isSecretPath } from "@/lib/files/safePath";
import { loadCtx, refuseReason, secretKind, SECRET_MSG, short } from "@/lib/files/folderRules";
import { isSanityMode } from "@/lib/sanityMode";
import { getSettingsKey, setSettingsKey } from "@/lib/settings";

export type Folder = { path: string; source: "added" | "claude-code" };
export type Browse = { path: string; parent: string | null; dirs: { name: string; path: string }[]; truncated: boolean };
export type Result<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };

const KEY = "addedFolders";
const MAX_ADDED = 100;
const BROWSE_CAP = 500;

const OPEN_SERVER_REFUSED_PROD =
  "Adding folders is off: this server runs in production without OWNER_EMAILS, so anyone signed in could reach any folder. Set OWNER_EMAILS first.";
const ON_VERCEL_REFUSED = "Working folders only work when Orrery runs on your own machine.";

const fail = (status: number, error: string) => ({ ok: false as const, status, error });
// Vercel is never your own machine, so folders stay off there whatever OWNER_EMAILS says.
const openServer = () => !!process.env.VERCEL || (process.env.NODE_ENV === "production" && !process.env.OWNER_EMAILS?.trim());

export const folderGoneMessage = (path: string) =>
  `${short(path)} isn't one of your folders any more. Add it again with Choose folder…, or pick another.`;

export async function folderAccess(userId: string): Promise<{ hostTools: boolean; reason: string | null }> {
  if (!(await canUseHostTools(userId))) return { hostTools: false, reason: HOST_TOOLS_REFUSED };
  return { hostTools: true, reason: !openServer() ? null : process.env.VERCEL ? ON_VERCEL_REFUSED : OPEN_SERVER_REFUSED_PROD };
}

async function readAdded(userId: string): Promise<string[]> {
  try {
    const list = JSON.parse((await getSettingsKey(userId, KEY)) ?? "[]");
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export async function allowedFolders(userId: string): Promise<Folder[]> {
  if (!(await canUseHostTools(userId))) return [];
  const out = new Map<string, Folder>();
  if (!openServer()) for (const path of await readAdded(userId)) out.set(path, { path, source: "added" });
  return withKnown(out);
}

async function withKnown(out: Map<string, Folder>): Promise<Folder[]> {
  // Sanity suite: one checked-in folder stands in for the Claude Code projects (e2e/files.spec.ts), so
  // screenshots and traces never depend on, or show, this machine's real project folders.
  const sanityFolder = isSanityMode() ? process.env.SANITY_WORKING_FOLDER : undefined;
  const others = isSanityMode() ? (sanityFolder ? [sanityFolder] : []) : (await listProjects()).map((p) => p.cwd);
  for (const path of others) if (!out.has(path)) out.set(path, { path, source: "claude-code" });
  return [...out.values()];
}

export async function isAllowedFolder(userId: string, path: string): Promise<boolean> {
  if (!(await canUseHostTools(userId))) return false;
  // An added folder is re-checked: it may since have been deleted, swapped for a symlink or now match a refuse rule.
  if (!openServer() && (await readAdded(userId)).includes(path)) {
    return (await realpath(/*turbopackIgnore: true*/ path).catch(() => null)) === path && (await refuseReason(path)) === null;
  }
  return (await withKnown(new Map())).some((f) => f.path === path);
}

/** Validates a typed path (steps 3-5 of addFolder) and returns its real path. */
async function resolveFolder(raw: unknown): Promise<Result<{ real: string }>> {
  if (typeof raw !== "string" || raw.trim().length < 1 || raw.trim().length > 1000 || raw.includes("\0")) {
    return fail(400, "Give the folder's full path, starting with /.");
  }
  let p = raw.trim();
  if (p === "~" || p.startsWith("~/")) p = join(/*turbopackIgnore: true*/ homedir(), p.slice(1));
  if (!isAbsolute(p)) return fail(400, "Give the folder's full path, starting with /.");
  let real: string;
  try {
    real = await realpath(/*turbopackIgnore: true*/ p);
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EACCES" ? fail(403, `Orrery can't read ${p}`) : fail(404, `No folder at ${p}`);
  }
  const st = await stat(/*turbopackIgnore: true*/ real).catch(() => null);
  if (!st) return fail(404, `No folder at ${p}`);
  if (!st.isDirectory()) return fail(400, `${p} is a file, not a folder.`);
  return { ok: true, real };
}

async function gate(userId: string, needAdd: boolean): Promise<Result<object>> {
  const { hostTools, reason } = await folderAccess(userId);
  if (!hostTools) return fail(403, HOST_TOOLS_REFUSED);
  if (needAdd && reason) return fail(403, reason);
  return { ok: true };
}

// ponytail: read-modify-write with no lock: two simultaneous writes can lose one (the lost folder fails closed). Upgrade: a per-user promise chain.
export async function addFolder(userId: string, raw: unknown): Promise<Result<{ path: string; added: boolean }>> {
  const g = await gate(userId, true);
  if (!g.ok) return g;
  const r = await resolveFolder(raw);
  if (!r.ok) return r;
  const refused = await refuseReason(r.real);
  if (refused) return fail(403, refused);
  const list = await readAdded(userId);
  if (list.includes(r.real)) return { ok: true, path: r.real, added: false };
  if (list.length >= MAX_ADDED) return fail(400, "You can add up to 100 folders. Remove one in Settings first.");
  await setSettingsKey(userId, KEY, JSON.stringify([r.real, ...list]));
  return { ok: true, path: r.real, added: true };
}

export async function removeFolder(userId: string, path: unknown): Promise<Result<object>> {
  const g = await gate(userId, false);
  if (!g.ok) return g;
  const list = await readAdded(userId);
  if (typeof path !== "string" || !list.includes(path)) return fail(404, "Only folders you added can be removed.");
  await setSettingsKey(userId, KEY, JSON.stringify(list.filter((p) => p !== path)));
  return { ok: true };
}

export async function browseFolder(userId: string, raw: string | null, hidden: boolean): Promise<Result<Browse>> {
  const g = await gate(userId, true);
  if (!g.ok) return g;
  const start = isSanityMode() && process.env.SANITY_WORKING_FOLDER ? dirname(process.env.SANITY_WORKING_FOLDER) : homedir();
  const r = await resolveFolder(raw?.trim() ? raw : start);
  if (!r.ok) return r;
  const { real } = r;
  // "/" and home may be browsed; only secret folders are refused here.
  const ctx = await loadCtx();
  if ((await secretKind(real, ctx)) === "inside") return fail(403, SECRET_MSG(real));
  const entries = await readdir(/*turbopackIgnore: true*/ real, { withFileTypes: true }).catch(() => null);
  if (!entries) return fail(403, `Orrery can't read ${real}`);
  const names = entries
    .filter((e) => e.isDirectory() && (hidden || !e.name.startsWith(".")) && !isSecretPath(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
  // Secret children are dropped even with hidden=1 (checked on the 500 shown, so the list can run a little short).
  const shown = names.slice(0, BROWSE_CAP);
  const kept = await Promise.all(shown.map(async (name) => ((await secretKind(join(/*turbopackIgnore: true*/ real, name), ctx, false)) === "inside" ? null : name)));
  return {
    ok: true,
    path: real,
    parent: real === "/" ? null : dirname(real),
    dirs: kept.filter((n): n is string => n !== null).map((name) => ({ name, path: join(/*turbopackIgnore: true*/ real, name) })),
    truncated: names.length > BROWSE_CAP,
  };
}
