import { prisma } from "@/lib/db";
import { HOST_TOOLS_REFUSED } from "@/lib/bridge/constants";

/** Tools that run on the server's own machine (Claude Code and the other CLIs, its folders, its home
 *  directory) belong to the server's owner. OWNER_EMAILS (comma-separated) lists who that is; unset means
 *  everyone signed in in development (one developer, own laptop) and no one in production. */
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
    if (process.env.NODE_ENV === "production") {
      if (!warned) {
        warned = true;
        console.warn("[hostAccess] OWNER_EMAILS is unset: host tools are refused for everyone in production. Set it to the server owner's email.");
      }
      return false;
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

/** Why this user can't use this server's folders and CLI models, or null when they can. */
export const hostToolsReason = async (userId: string): Promise<string | null> => ((await canUseHostTools(userId)) ? null : HOST_TOOLS_REFUSED);

/** For tests: forget cached answers and the one-time warning. */
export function resetHostAccessCache() {
  cache.clear();
  warned = false;
}

export { HOST_TOOLS_REFUSED };
