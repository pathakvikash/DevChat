import { createHmac, timingSafeEqual } from "node:crypto";

/** JSON with object keys sorted, so the same value always signs the same. */
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x)) ?? "null";

/** HMAC-SHA256(AUTH_SECRET, artifactId|app|stableJSON(refresh)). Null without AUTH_SECRET. Only Orrery's own app-result
 *  save signs, so a `refresh` the model wrote into an artifact cannot make the server call an app tool. */
export function refreshSig(artifactId: string, app: string, refresh: unknown): string | null {
  const secret = process.env.AUTH_SECRET;
  return secret ? createHmac("sha256", secret).update(`${artifactId}|${app}|${stable(refresh)}`).digest("hex") : null;
}

export function verifyRefreshSig(artifactId: string, app: string, refresh: unknown, sig: unknown): boolean {
  const want = refreshSig(artifactId, app, refresh);
  if (!want || typeof sig !== "string") return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Model- or code-written JSON content must not carry the keys Orrery adds to a saved app result. */
export function stripRefreshKeys(content: string): string {
  try {
    const v = JSON.parse(content);
    if (!v || typeof v !== "object" || Array.isArray(v) || !("refresh" in v || "app" in v || "sig" in v)) return content;
    const { refresh: _r, app: _a, sig: _s, ...rest } = v;
    return JSON.stringify(rest);
  } catch {
    return content;
  }
}
