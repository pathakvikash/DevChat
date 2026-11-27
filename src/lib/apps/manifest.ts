import { safeFetch } from "@/lib/net/safeFetch";
import { manifestSchema, type AppManifest } from "./types";

export const MANIFEST_MAX_BYTES = 64 * 1024;
export const MANIFEST_TIMEOUT_MS = 5000;
const WELL_KNOWN = "/.well-known/orrery-app.json";

export class ManifestError extends Error {}

const isLocal = (h: string) => h === "localhost" || h === "127.0.0.1";
const dev = () => process.env.NODE_ENV !== "production";

/** https only; http only for localhost / 127.0.0.1 outside production. */
export function assertAllowedUrl(u: URL, what = "URL"): void {
  if (u.protocol === "https:") return;
  if (u.protocol === "http:" && dev() && isLocal(u.hostname)) return;
  throw new ManifestError(`${what} must use https`);
}

const samePath = (p: string) => p.startsWith("/") && !p.startsWith("//") && !p.includes("\\");

function pin(origin: string, raw: string, what: string): void {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ManifestError(`${what} is not a valid URL`);
  }
  if (u.origin !== origin) throw new ManifestError(`${what} must be on ${origin}`);
}

/** Checks the manifest against the origin it was fetched from. Throws ManifestError. */
export function validateManifest(raw: unknown, origin: string): AppManifest {
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    const version = (raw as { manifestVersion?: unknown } | null)?.manifestVersion;
    if (version !== undefined && version !== 1) throw new ManifestError(`Unsupported manifestVersion ${String(version)}`);
    throw new ManifestError(`Invalid manifest: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const m = parsed.data;
  pin(origin, m.baseUrl, "baseUrl");
  pin(origin, m.mcp.url, "mcp.url");
  if (m.icon) pin(origin, m.icon, "icon");
  if (m.sso && !samePath(m.sso.path)) throw new ManifestError("sso.path must be a path on the app");
  for (const [k, p] of Object.entries(m.deepLinks)) if (!samePath(p)) throw new ManifestError(`deepLinks.${k} must be a path on the app`);
  return m;
}

/** Accepts the app's base URL or the full manifest URL. */
export function manifestUrlFor(input: string): URL {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw new ManifestError("Not a valid URL");
  }
  assertAllowedUrl(u, "App URL");
  if (!u.pathname.endsWith("orrery-app.json")) u = new URL(WELL_KNOWN, u.origin);
  u.hash = "";
  return u;
}

async function getText(u: URL): Promise<string> {
  if (dev() && isLocal(u.hostname)) {
    // safeFetch refuses loopback on purpose; development only. In production an https://localhost URL passes
    // assertAllowedUrl, so it must still go through safeFetch, which refuses it.
    const res = await fetch(u, { signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS), redirect: "error" });
    if (!res.ok) throw new ManifestError(`Manifest request failed (${res.status})`);
    const text = await res.text();
    if (text.length > MANIFEST_MAX_BYTES) throw new ManifestError("Manifest is over 64 KB");
    return text;
  }
  try {
    const res = await safeFetch(u.toString(), { maxBytes: MANIFEST_MAX_BYTES, timeoutMs: MANIFEST_TIMEOUT_MS });
    if (!res.ok) throw new ManifestError(`Manifest request failed (${res.status})`);
    // A redirect may not move the manifest to another origin.
    if (new URL(res.url).origin !== u.origin) throw new ManifestError("Manifest redirected to another origin");
    return res.text;
  } catch (e) {
    if (e instanceof ManifestError) throw e;
    throw new ManifestError(e instanceof Error && /over/.test(e.message) ? "Manifest is over 64 KB" : `Could not fetch manifest: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function fetchManifest(url: string): Promise<{ manifest: AppManifest; origin: string }> {
  const u = manifestUrlFor(url);
  const text = await getText(u);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ManifestError("Manifest is not valid JSON");
  }
  return { manifest: validateManifest(json, u.origin), origin: u.origin };
}
