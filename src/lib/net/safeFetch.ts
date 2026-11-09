import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Readable } from "node:stream";

export const SAFE_FETCH_MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 15_000;

export class SafeFetchError extends Error {}
const PRIVATE = "That address is private and cannot be fetched";

/** IPv6 text (any valid form) as eight 16-bit groups. */
function v6Groups(ip: string): number[] {
  let s = ip.toLowerCase().split("%")[0];
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const [a, b, c, d] = tail[1].split(".").map(Number);
    s = s.slice(0, -tail[1].length) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const [head, rest] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = rest === undefined ? [] : rest ? rest.split(":") : [];
  const fill = rest === undefined ? [] : Array<string>(8 - h.length - t.length).fill("0");
  return [...h, ...fill, ...t].map((g) => parseInt(g || "0", 16));
}

function blockedV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 || // this network, private, loopback, multicast and reserved
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local and the cloud metadata address
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) // benchmarking
  );
}

/** True for loopback, private, link-local, CGNAT, ULA, multicast, metadata and unspecified addresses. */
export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return blockedV4(ip);
  if (kind !== 6) return true;
  const g = v6Groups(ip);
  const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return blockedV4(v4(g[6], g[7])); // ::ffff:a.b.c.d, ::a.b.c.d (also ::, ::1)
  if (g[0] === 0x64 && g[1] === 0xff9b) return blockedV4(v4(g[6], g[7])); // NAT64
  return (
    (g[0] & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (g[0] & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (g[0] & 0xff00) === 0xff00 || // multicast
    (g[0] === 0x2001 && g[1] === 0) // Teredo
  );
}

function resolveAll(host: string): Promise<LookupAddress[]> {
  return new Promise((resolve, reject) => dnsLookup(host, { all: true }, (err, addrs) => (err ? reject(err) : resolve(addrs))));
}

/** The connection's own DNS lookup: the address that is checked is the address that is connected to, so a name that
 *  answers differently the second time (DNS rebinding) is still refused. Literal IPs skip it (see assertPublicUrl). */
const guardedLookup: typeof dnsLookup = ((host: string, options: { all?: boolean; family?: number; hints?: number }, cb: (...a: unknown[]) => void) => {
  dnsLookup(host, { all: true, family: options.family, hints: options.hints }, (err, addrs) => {
    if (err) return cb(err);
    if (addrs.length === 0 || addrs.some((a) => isBlockedIp(a.address))) return cb(new SafeFetchError(PRIVATE));
    if (options.all) cb(null, addrs);
    else cb(null, addrs[0].address, addrs[0].family);
  });
}) as unknown as typeof dnsLookup;

/** Early, friendly refusal. The connection re-checks in guardedLookup, which is the check that counts. */
async function assertPublicUrl(u: URL): Promise<void> {
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new SafeFetchError(`Only http and https URLs are allowed, not ${u.protocol}`);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost")) throw new SafeFetchError(PRIVATE);
  // `new URL` already turned decimal and hex forms (http://2130706433/) into dotted IPv4.
  const addrs = isIP(host) ? [host] : (await resolveAll(host)).map((a) => a.address);
  if (addrs.length === 0 || addrs.some(isBlockedIp)) throw new SafeFetchError(PRIVATE);
}

export interface SafeFetchOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  maxBytes?: number;
  timeoutMs?: number;
  /** Cut the body at maxBytes instead of failing. */
  truncate?: boolean;
}

export interface SafeFetchResult {
  status: number;
  ok: boolean;
  url: string;
  contentType: string;
  text: string;
}

function send(url: URL, headers: Record<string, string> | undefined, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { "accept-encoding": "gzip, deflate, br", ...headers },
        lookup: guardedLookup,
        signal,
      },
      resolve,
    );
    req.on("error", reject);
    req.end();
  });
}

/** The body as it arrives: gzip, deflate and br are decoded, so the size cap counts decoded bytes. */
function decoded(res: IncomingMessage): Readable {
  const enc = String(res.headers["content-encoding"] ?? "").toLowerCase().trim();
  const decoder = enc === "gzip" || enc === "x-gzip" ? createGunzip() : enc === "deflate" ? createInflate() : enc === "br" ? createBrotliDecompress() : null;
  if (!decoder) return res;
  res.on("error", (e) => decoder.destroy(e));
  return res.pipe(decoder);
}

/**
 * GET only. Every hop: protocol and literal-IP checks, then the connection itself resolves the name through
 * guardedLookup, which refuses private, loopback, link-local, CGNAT, ULA, multicast and metadata addresses.
 * At most 3 redirects, followed by hand. Reads at most `maxBytes` (2 MB) of decoded body.
 * Throws SafeFetchError for a blocked URL, too many redirects or an oversize body.
 */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? SAFE_FETCH_MAX_BYTES;
  const signal = AbortSignal.any([AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS), ...(opts.signal ? [opts.signal] : [])]);
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SafeFetchError("Not a valid URL");
  }
  for (let hop = 0; ; hop++) {
    await assertPublicUrl(url);
    const res = await send(url, opts.headers, signal);
    const status = res.statusCode ?? 0;
    const location = res.headers.location;
    if (status >= 300 && status < 400 && location) {
      res.resume();
      if (hop >= MAX_REDIRECTS) throw new SafeFetchError("Too many redirects");
      url = new URL(location, url);
      continue;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    const body = decoded(res);
    try {
      for await (const chunk of body) {
        const buf = chunk as Buffer;
        size += buf.length;
        if (size > maxBytes) {
          if (!opts.truncate) throw new SafeFetchError(`Response is over ${Math.round(maxBytes / 1024 / 1024)} MB`);
          chunks.push(buf.subarray(0, buf.length - (size - maxBytes)));
          break;
        }
        chunks.push(buf);
      }
    } finally {
      body.destroy();
      res.destroy();
    }
    return {
      status,
      ok: status >= 200 && status < 300,
      url: url.toString(),
      contentType: String(res.headers["content-type"] ?? ""),
      text: Buffer.concat(chunks).toString("utf8"),
    };
  }
}
