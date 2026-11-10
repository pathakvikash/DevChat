/**
 * Public origin of this deployment. `AUTH_URL` wins; otherwise the forwarded headers (first value of a comma list),
 * then the Host header. In dev, `nextUrl.origin` can say localhost for a 127.0.0.1 page, which is why it is not used.
 */
export function appOrigin(req: { headers: Headers; nextUrl?: { protocol: string } }): string {
  if (process.env.AUTH_URL) {
    try {
      return new URL(process.env.AUTH_URL).origin;
    } catch {
      // fall through to headers
    }
  }
  const first = (v: string | null) => v?.split(",")[0].trim() || null;
  const host = first(req.headers.get("x-forwarded-host")) ?? first(req.headers.get("host")) ?? "localhost:3000";
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host);
  const proto = first(req.headers.get("x-forwarded-proto")) ?? req.nextUrl?.protocol.replace(/:$/, "") ?? (local ? "http" : "https");
  return `${proto}://${host}`;
}
