import { safeFetch } from "./safeFetch";

const TTL_OK = 10 * 60_000;
const TTL_NO = 2 * 60_000;
const MAX_ENTRIES = 500;
const verdicts = new Map<string, { public: boolean; until: number }>();

const token = () => process.env.GITHUB_TOKEN?.trim() || "";

/** owner/repo for https://api.github.com/repos/{owner}/{repo}[/...], else null. */
function repoOf(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "api.github.com" || u.port || u.username || u.password) return null;
  const m = u.pathname.match(/^\/repos\/([^/]+)\/([^/]+)(?:\/|$)/);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

/** True only when GitHub itself says the repo is public (asked with the token, so a private repo is not hidden by a 404). */
async function isPublic(repo: string, tok: string, signal?: AbortSignal): Promise<boolean> {
  const hit = verdicts.get(repo);
  if (hit && hit.until > Date.now()) return hit.public;
  let ok = false;
  try {
    const res = await safeFetch(`https://api.github.com/repos/${repo}`, {
      headers: { Authorization: `Bearer ${tok}`, Accept: "application/vnd.github+json", "User-Agent": "DevChat" },
      signal,
      timeoutMs: 10_000,
    });
    if (res.status === 200) {
      const j = JSON.parse(res.text);
      ok = j?.private === false && (j.visibility === undefined || j.visibility === "public");
    }
  } catch {
    // any failure: treat as not public
  }
  if (verdicts.size >= MAX_ENTRIES) verdicts.clear();
  verdicts.set(repo, { public: ok, until: Date.now() + (ok ? TTL_OK : TTL_NO) });
  return ok;
}

/** Authorization header for GITHUB_TOKEN, only for public-repo API URLs; otherwise {} (the request goes out without a login). */
export async function githubAuthHeaders(url: string, signal?: AbortSignal): Promise<Record<string, string>> {
  const tok = token();
  if (!tok) return {};
  const repo = repoOf(url);
  if (!repo || !(await isPublic(repo, tok, signal))) return {};
  return { Authorization: `Bearer ${tok}` };
}

/** " — hint" for a GitHub rate-limit answer, else "". */
export function githubRateLimitHint(status: number, url: string, message: string): string {
  if (status !== 403 && status !== 429) return "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return "";
  }
  if (host !== "api.github.com" || !/rate limit/i.test(message)) return "";
  return token()
    ? " — the GITHUB_TOKEN's hourly limit is used up"
    : " — GitHub's hourly limit for requests without a login is used up; set GITHUB_TOKEN on the server (a token with no scopes is enough)";
}
