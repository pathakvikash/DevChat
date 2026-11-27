// SSO landing route: verify the 60 s handoff token, let the app create its own session, redirect.
import { OrreryAuthError, verifyHandoffToken, type JtiStore } from "./token";

export interface SsoOptions {
  secret: string;
  appId: string;
  issuer?: string;
  jtiStore?: JtiStore;
  /** Create your session for this email. Return Set-Cookie header value(s) to attach to the redirect. */
  mintSession(email: string, req: Request): void | string | string[] | Promise<void | string | string[]>;
}

/** Same-origin relative paths only; anything else becomes "/". */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\u0000-\u001f]/.test(next)) return "/";
  return next;
}

export function ssoHandler(o: SsoOptions): (req: Request) => Promise<Response> {
  return async (req) => {
    const url = new URL(req.url);
    try {
      const { email } = verifyHandoffToken(url.searchParams.get("token"), { secret: o.secret, appId: o.appId, issuer: o.issuer, jtiStore: o.jtiStore });
      const cookies = await o.mintSession(email, req);
      const headers = new Headers({ Location: new URL(safeNext(url.searchParams.get("next")), url.origin).toString() });
      for (const c of cookies === undefined ? [] : Array.isArray(cookies) ? cookies : [cookies]) headers.append("Set-Cookie", c);
      return new Response(null, { status: 302, headers });
    } catch (e) {
      if (e instanceof OrreryAuthError) return new Response(e.message, { status: 401 });
      throw e;
    }
  };
}
