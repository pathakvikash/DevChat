// Validates the manifest you serve at /.well-known/orrery-app.json (mirrors manifestSchema in Orrery).
const RESULT_TYPES = ["table", "timeseries", "ohlc", "model3d", "job", "link"];

export interface OrreryManifest {
  manifestVersion: 1;
  id: string;
  name: string;
  icon?: string;
  baseUrl: string;
  description: string;
  goodFor: string;
  mcp: { url: string };
  auth: "none" | "orrery-jwt";
  sso?: { path: string };
  capabilities?: ("table" | "timeseries" | "ohlc" | "model3d" | "job" | "link")[];
  deepLinks?: Record<string, string>;
  permission: "read" | "actions";
}

/** Returns the manifest (defaults filled) or throws one readable error listing every problem. */
export function defineManifest(m: OrreryManifest): OrreryManifest {
  const errs: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const x = m as unknown as Record<string, any>;
  const str = (k: string, max: number, min = 1) => {
    if (typeof x[k] !== "string" || x[k].length < min || x[k].length > max) errs.push(`${k}: string of ${min}-${max} chars required`);
  };
  const isUrl = (v: unknown) => {
    try {
      new URL(v as string);
      return typeof v === "string";
    } catch {
      return false;
    }
  };
  if (x.manifestVersion !== 1) errs.push("manifestVersion: must be 1");
  if (typeof x.id !== "string" || !/^[a-z0-9-]{2,32}$/.test(x.id)) errs.push("id: must match [a-z0-9-]{2,32}");
  str("name", 60);
  str("description", 400, 0);
  str("goodFor", 160, 0);
  if (!isUrl(x.baseUrl)) errs.push("baseUrl: valid URL required");
  if (x.icon !== undefined && !isUrl(x.icon)) errs.push("icon: valid URL required");
  if (!isUrl(x.mcp?.url)) errs.push("mcp.url: valid URL required");
  if (!["none", "orrery-jwt"].includes(x.auth)) errs.push('auth: "none" or "orrery-jwt"');
  if (!["read", "actions"].includes(x.permission)) errs.push('permission: "read" or "actions"');
  if (x.sso !== undefined && !(typeof x.sso?.path === "string" && x.sso.path.startsWith("/"))) errs.push('sso.path: must start with "/"');
  const caps = x.capabilities ?? [];
  if (!Array.isArray(caps) || caps.some((c: unknown) => !RESULT_TYPES.includes(c as string))) errs.push(`capabilities: subset of ${RESULT_TYPES.join(", ")}`);
  const links = x.deepLinks ?? {};
  if (typeof links !== "object" || Array.isArray(links) || Object.values(links).some((v) => typeof v !== "string" || !v.startsWith("/")))
    errs.push('deepLinks: values must be strings starting with "/"');
  if (isUrl(x.baseUrl)) {
    const base = new URL(x.baseUrl);
    if (base.protocol !== "https:" && base.hostname !== "localhost") errs.push("baseUrl: https required (http only for localhost)");
    for (const [k, v] of [["mcp.url", x.mcp?.url], ["icon", x.icon]] as const)
      if (v !== undefined && isUrl(v) && new URL(v).origin !== base.origin) errs.push(`${k}: must share origin ${base.origin}`);
  }
  if (errs.length) throw new Error(`Invalid Orrery manifest:\n- ${errs.join("\n- ")}`);
  return { ...m, capabilities: caps, deepLinks: links };
}
