import { prisma } from "@/lib/db";

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

/** Whether this user can use a command-line model with a folder here: the server's owner, on a machine that has them (not Vercel). */
export async function hostToolsHere(userId: string): Promise<boolean> {
  return !process.env.VERCEL && (await canUseHostTools(userId));
}

/** For tests: forget cached answers and the one-time warning. */
export function resetHostAccessCache() {
  cache.clear();
  warned = false;
}

export const HOST_TOOLS_REFUSED = "This is only available to the server's owner.";
