import type { AppRecord } from "./types";

export class GoError extends Error {}

/**
 * Where "open in the app" goes: built only from the app's approved deep-link template, with every param
 * URI-encoded, never from a raw user URL. Returns the same-origin target and, with sso, the handoff URL.
 * `token` is only called when the app has an sso path.
 */
export async function buildGoUrl(
  app: Pick<AppRecord, "baseUrl" | "ssoPath" | "deepLinks">,
  link: string | null,
  paramsJson: string | null,
  token: () => Promise<string>,
): Promise<string> {
  let path = "/";
  // `home` falls back to the app's root unless the manifest defines its own `home` link.
  if (link && !(link === "home" && !Object.hasOwn(app.deepLinks, "home"))) {
    const tpl = Object.hasOwn(app.deepLinks, link) ? app.deepLinks[link] : undefined;
    if (!tpl) throw new GoError("Unknown link");
    let params: Record<string, unknown> = {};
    if (paramsJson) {
      try {
        const v = JSON.parse(paramsJson);
        if (v && typeof v === "object" && !Array.isArray(v)) params = v as Record<string, unknown>;
        else throw new Error();
      } catch {
        throw new GoError("params must be a JSON object");
      }
    }
    path = tpl.replace(/\{(\w+)\}/g, (_m, k: string) => {
      const v = Object.hasOwn(params, k) ? params[k] : undefined;
      if (typeof v !== "string" && typeof v !== "number") throw new GoError(`Missing param ${k}`);
      return encodeURIComponent(String(v));
    });
  }
  const base = new URL(app.baseUrl);
  const target = new URL(path, base);
  if (!path.startsWith("/") || path.startsWith("//") || target.origin !== base.origin) throw new GoError("Link leaves the app's origin");
  const next = `${target.pathname}${target.search}`;
  if (!app.ssoPath) return target.toString();
  const dest = new URL(app.ssoPath, base);
  if (dest.origin !== base.origin) throw new GoError("sso path leaves the app's origin");
  dest.searchParams.set("token", await token());
  dest.searchParams.set("next", next);
  return dest.toString();
}
