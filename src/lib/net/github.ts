import { safeFetch } from "./safeFetch";

const token = () => process.env.GITHUB_TOKEN?.trim() || "";

/** owner/repo for the paths the explainer reads (repo root, trees, contents, readme), else null. A repo-scoped token can also
 *  read admin-only data (hooks, variables, collaborators), so every other path goes out without a login. */
function repoOf(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "api.github.com" || u.port || u.username || u.password) return null;
  const m = u.pathname.match(/^\/repos\/([^/]+)\/([^/]+)(?:\/(?:git\/trees|contents|readme)(?:\/.*)?)?$/);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

/** Asked on every call (a repo can turn private at any time). True only when GitHub itself says the repo is public
 *  (asked with the token, so a private repo is not hidden by a 404). */
async function isPublic(repo: string, tok: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await safeFetch(`https://api.github.com/repos/${repo}`, {
      headers: { Authorization: `Bearer ${tok}`, Accept: "application/vnd.github+json", "User-Agent": "DevChat" },
      signal,
      timeoutMs: 10_000,
    });
    if (res.status !== 200) return false;
    const j = JSON.parse(res.text);
    return j?.private === false && (j.visibility === undefined || j.visibility === "public");
  } catch {
    return false; // any failure: treat as not public
  }
}

/** Authorization header for GITHUB_TOKEN, only for explainer paths of public repos; otherwise {} (the request goes out without a login). */
export async function githubAuthHeaders(url: string, signal?: AbortSignal): Promise<Record<string, string>> {
  const tok = token();
  if (!tok) return {};
  const repo = repoOf(url);
  if (!repo || !(await isPublic(repo, tok, signal))) return {};
  return { Authorization: `Bearer ${tok}` };
}

/** Error text for a failed fetch. APIs explain themselves in a JSON "message". `authed`: this request carried the token. */
export function httpErrorText(status: number, url: string, body: string, authed: boolean): string {
  let why = "";
  try {
    const m = JSON.parse(body)?.message;
    if (typeof m === "string") why = `: ${m.slice(0, 200)}${rateLimitHint(status, url, m, authed)}`;
  } catch {
    // not JSON: the status alone
  }
  return `HTTP ${status}${why} for ${url}`;
}

function rateLimitHint(status: number, url: string, message: string, authed: boolean): string {
  if (status !== 403 && status !== 429) return "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return "";
  }
  if (host !== "api.github.com" || !/rate limit/i.test(message)) return "";
  if (authed) return " — the GITHUB_TOKEN's hourly limit is used up";
  if (token()) return ""; // set but not used for this request: the hint would mislead
  return " — GitHub's hourly limit for requests without a login is used up; set GITHUB_TOKEN on the server (a token with no scopes is enough)";
}
