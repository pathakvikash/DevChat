import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";

const key = (secret: string) => new TextEncoder().encode(secret);

function sign(extra: Record<string, unknown>, { appId, email, secret }: { appId: string; email: string; secret: string }) {
  return new SignJWT(extra)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("orrery")
    .setAudience(appId)
    .setSubject(email)
    .setIssuedAt()
    .setExpirationTime("60s")
    .setJti(randomUUID())
    .sign(key(secret));
}

/** Per-call service token: HS256, aud = app id, sub = user email, 60 s. */
export const signAppToken = (o: { appId: string; email: string; secret: string }) => sign({}, o);

/** Single-use SSO handoff token (same shape plus typ/purpose so a service token can't be replayed as a login). */
export const signHandoffToken = (o: { appId: string; email: string; secret: string }) => sign({ typ: "sso", purpose: "sso" }, o);
