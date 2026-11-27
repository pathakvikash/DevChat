// Relative, not "@/": next.config.ts imports this file before the alias exists.
import { MARKETING_PATHS } from "./marketing/pages";

/** Public identity of the site, shared by metadata, robots, sitemap and the landing page. */
export const SITE_NAME = "Orrery";
export const SITE_TAGLINE = "A multi-model AI chat workspace";
export const SITE_DESCRIPTION =
  "Orrery is a multi-model AI chat workspace. Chat with Anthropic, OpenAI, Gemini and local models, switch between Ask and Agent modes, run workflows, and keep artifacts and connected apps in one place.";

/**
 * SITE_URL wins, then the Vercel production host, then localhost outside production. In production with neither
 * set (or an unparseable value) it is null, and callers emit no absolute URL rather than advertise another host.
 */
export function siteUrl(env: Record<string, string | undefined> = process.env): URL | null {
  const raw =
    env.SITE_URL ||
    (env.VERCEL_PROJECT_PRODUCTION_URL && `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
    (env.NODE_ENV === "production" ? "" : "http://localhost:3000");
  try {
    return raw ? new URL(raw) : null;
  } catch {
    return null;
  }
}

/** Pages a signed-out visitor can read and a crawler may index: the landing page plus the marketing pages. */
export const PUBLIC_PATHS: readonly string[] = ["/", ...MARKETING_PATHS];

/** Exactly the public pages and their share images. A prefix match would open anything under /features/. */
const PUBLIC_EXACT = new Set(["/welcome", ...PUBLIC_PATHS]); // /welcome: what the middleware rewrites signed-out "/" to
// A page's share image: its own path plus opengraph-image or twitter-image, optionally with Next's hash suffix.
const SHARE_IMAGE = /^(\/[^/]+\/[^/]+)\/(?:opengraph|twitter)-image(?:-[a-z0-9]+)?$/;
export const isPublicPath = (pathname: string) =>
  PUBLIC_EXACT.has(pathname) || PUBLIC_EXACT.has(SHARE_IMAGE.exec(pathname)?.[1] ?? "");

/** Top-level segments that belong to the signed-in app. */
export const PRIVATE_SEGMENTS = [
  "api",
  "c",
  "claude",
  "kb",
  "memory",
  "notes",
  "observability",
  "settings",
  "tables",
  "workflows",
  "artifacts",
  "artifact-preview",
  "login",
] as const;
