// Verifies Orrery service tokens (HS256 JWT). Zero dependencies: node:crypto only.
import { createHmac, timingSafeEqual } from "node:crypto";

export class OrreryAuthError extends Error {
  readonly status = 401;
  constructor(message: string) {
    super(message);
    this.name = "OrreryAuthError";
  }
}

export interface VerifyOptions {
  secret: string;
  appId: string;
  issuer?: string;
  skewSeconds?: number;
  /** Optional single-use guard for service tokens. */
  jtiStore?: JtiStore;
}

export interface JtiStore {
  /** Returns true if the jti was already used; otherwise records it and returns false. */
  seen(jti: string): boolean;
}

/**
 * In-memory single-use guard. PER INSTANCE: on serverless (Vercel) each instance has its own
 * memory, so this only blocks replays that hit the same warm instance. Use a shared store
 * (Redis, DB unique key) if you need a hard guarantee.
 */
export function createJtiStore({ ttlSeconds = 120 }: { ttlSeconds?: number } = {}): JtiStore {
  const used = new Map<string, number>();
  return {
    seen(jti) {
      const now = Date.now();
      for (const [k, exp] of used) if (exp <= now) used.delete(k);
      if (used.has(jti)) return true;
      used.set(jti, now + ttlSeconds * 1000);
      return false;
    },
  };
}

const b64urlToBuf = (s: string) => Buffer.from(s, "base64url");
const parseJson = (buf: Buffer): Record<string, unknown> => {
  try {
    const v = JSON.parse(buf.toString("utf8"));
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new OrreryAuthError("malformed token");
};

function verifyJwt(token: string, o: VerifyOptions): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new OrreryAuthError("malformed token");
  const header = parseJson(b64urlToBuf(parts[0]));
  if (header.alg !== "HS256") throw new OrreryAuthError("unsupported alg");
  const expected = createHmac("sha256", o.secret).update(`${parts[0]}.${parts[1]}`).digest();
  const given = b64urlToBuf(parts[2]);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new OrreryAuthError("bad signature");
  const c = parseJson(b64urlToBuf(parts[1]));
  const skew = o.skewSeconds ?? 30;
  const now = Math.floor(Date.now() / 1000);
  if (c.iss !== (o.issuer ?? "orrery")) throw new OrreryAuthError("bad issuer");
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(o.appId)) throw new OrreryAuthError("bad audience");
  if (typeof c.exp !== "number" || c.exp + skew < now) throw new OrreryAuthError("token expired");
  if (typeof c.iat !== "number" || c.iat - skew > now) throw new OrreryAuthError("token issued in the future");
  if (typeof c.sub !== "string" || !c.sub) throw new OrreryAuthError("missing subject");
  if (typeof c.jti !== "string" || !c.jti) throw new OrreryAuthError("missing jti");
  return c;
}

/** Verify `Authorization: Bearer <jwt>`. Returns the user's email (`sub`) and the token id. */
export function verifyOrreryToken(authorizationHeader: string | null | undefined, o: VerifyOptions): { email: string; jti: string } {
  const m = /^Bearer\s+(\S+)$/i.exec(authorizationHeader ?? "");
  if (!m) throw new OrreryAuthError("missing bearer token");
  if (!o.secret) throw new OrreryAuthError("app secret not configured");
  const c = verifyJwt(m[1], o);
  if (c.purpose !== undefined) throw new OrreryAuthError("handoff token cannot be used as a service token");
  if (o.jtiStore?.seen(c.jti as string)) throw new OrreryAuthError("token already used");
  return { email: c.sub as string, jti: c.jti as string };
}

const defaultHandoffStore = createJtiStore({ ttlSeconds: 120 });

/** Verify the 60 s single-use SSO handoff token from `?token=`. purpose must be "sso". */
export function verifyHandoffToken(token: string | null | undefined, o: VerifyOptions): { email: string; jti: string } {
  if (!token) throw new OrreryAuthError("missing token");
  if (!o.secret) throw new OrreryAuthError("app secret not configured");
  const c = verifyJwt(token, o);
  if (c.purpose !== "sso") throw new OrreryAuthError("wrong token purpose");
  if ((c.exp as number) - (c.iat as number) > 60) throw new OrreryAuthError("handoff token lifetime too long");
  if ((o.jtiStore ?? defaultHandoffStore).seen(c.jti as string)) throw new OrreryAuthError("token already used");
  return { email: c.sub as string, jti: c.jti as string };
}
