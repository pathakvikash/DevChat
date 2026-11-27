import { timingSafeEqual } from "node:crypto";

// The guard for the local bridge daemon. Pure: no I/O, so it is unit-tested without a socket.
export const BRIDGE_PORT = 47321;
export const BRIDGE_PROTOCOL = 1;

export type BridgeRequest = {
  method?: string;
  host?: string;
  origin?: string;
  authorization?: string;
  contentType?: string;
};
export type BridgeGuardConfig = { token: string; origins: readonly string[]; port?: number };
export type BridgeVerdict = { ok: true } | { ok: false; status: number; reason: string };

const no = (status: number, reason: string): BridgeVerdict => ({ ok: false, status, reason });

/** Length-safe constant-time compare. */
function sameToken(given: string, token: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  // The length check leaks only the length of a 256-bit token, which is fixed.
  return a.length === b.length && timingSafeEqual(a, b);
}

/** True for an exact allowlist hit; a missing or "null" origin never matches. */
export const originAllowed = (origin: string | undefined, origins: readonly string[]) =>
  !!origin && origin !== "null" && origins.includes(origin);

/**
 * Checks one request before its body is read. Host must be exactly 127.0.0.1:<port> (a rebound DNS name sends its own
 * Host, and `localhost` is refused too), Origin must be in the allowlist, and a bearer token must match.
 * A preflight from an allowed origin passes without a token. Tokens in the query string are never read.
 */
export function checkBridgeRequest(req: BridgeRequest, cfg: BridgeGuardConfig): BridgeVerdict {
  const port = cfg.port ?? BRIDGE_PORT;
  if (req.host !== `127.0.0.1:${port}`) return no(403, "Bad Host header");
  if (!originAllowed(req.origin, cfg.origins)) return no(403, "Origin not allowed");
  if (req.method === "OPTIONS") return { ok: true };
  const m = /^Bearer (.+)$/.exec(req.authorization ?? "");
  if (!m || !cfg.token || !sameToken(m[1], cfg.token)) return no(401, "Missing or wrong token");
  if (req.method === "POST" && !/^application\/json\s*(;|$)/i.test(req.contentType ?? "")) return no(415, "POST needs application/json");
  return { ok: true };
}

/** CORS headers for an allowed origin only (nothing is echoed for others). `preflight` adds the Private Network Access opt-in. */
export function corsHeaders(origin: string | undefined, origins: readonly string[], preflight = false): Record<string, string> {
  const h: Record<string, string> = { Vary: "Origin" };
  if (!originAllowed(origin, origins)) return h;
  h["Access-Control-Allow-Origin"] = origin!;
  h["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
  h["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
  if (preflight) {
    h["Access-Control-Allow-Private-Network"] = "true";
    h["Access-Control-Max-Age"] = "600";
  }
  return h;
}
