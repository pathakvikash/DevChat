import { prisma } from "@/lib/db";
import { findCliBins } from "@/lib/cliProviders";
import { isSanityMode } from "@/lib/sanityMode";

/** Tools that run on the server's own machine (Claude Code and the other CLIs, its folders, its home
 *  directory) belong to the server's owner. OWNER_EMAILS (comma-separated) lists who that is; unset means
 *  everyone signed in, which is right for one developer on their own laptop and wrong on a shared server. */
function ownerEmails(): Set<string> | null {
  const raw = process.env.OWNER_EMAILS;
  if (raw === undefined || !raw.trim()) return null;
  return new Set(raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
}

/** A role change takes effect within this long. */
const TTL_MS = 30_000;
const cache = new Map<string, { ok: boolean; at: number }>();
let warned = false;

export async function canUseHostTools(userId: string): Promise<boolean> {
  const owners = ownerEmails();
  if (!owners) {
    if (!warned && process.env.NODE_ENV === "production") {
      warned = true;
      console.warn("[hostAccess] OWNER_EMAILS is unset: every signed-in user can use this server's CLI tools and folders. Set it on a shared server.");
    }
    return true;
  }
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ok;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const ok = !!user?.email && owners.has(user.email.toLowerCase());
  cache.set(userId, { ok, at: Date.now() });
  return ok;
}

/** Why this user can't use a Claude Code or OpenCode model with a folder here, or null when they can: not the server's owner, or
 *  no CLI installed. Sanity mode counts as installed (the tests have none). */
export async function hostToolsReason(userId: string): Promise<string | null> {
  if (!(await canUseHostTools(userId))) return HOST_TOOLS_REFUSED;
  if (isSanityMode()) return null;
  const bins = await findCliBins();
  return bins.has("claude-code") || bins.has("opencode") ? null : FOLDER_TEMPLATE_REFUSED;
}

export const hostToolsHere = async (userId: string): Promise<boolean> => (await hostToolsReason(userId)) === null;

export const FOLDER_TEMPLATE_REFUSED = "Explaining a folder needs Claude Code or OpenCode on this server.";

/** For tests: forget cached answers and the one-time warning. */
export function resetHostAccessCache() {
  cache.clear();
  warned = false;
}

export const HOST_TOOLS_REFUSED = "This is only available to the server's owner.";
