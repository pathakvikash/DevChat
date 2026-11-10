import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { gzipSync, brotliCompressSync, deflateSync } from "node:zlib";

const lookup = vi.fn();
vi.mock("node:dns", () => ({
  lookup: (host: string, opts: unknown, cb: (e: Error | null, a?: unknown) => void) => Promise.resolve(lookup(host, opts)).then((a) => cb(null, a), (e) => cb(e)),
}));

type Reply = { status?: number; headers?: Record<string, string>; body?: string | Buffer };
const sent: { opts: any }[] = [];
let reply: (n: number) => Reply = () => ({ body: "" });
// A stand-in for http(s).request: records the options, then answers with a stream like IncomingMessage.
function fakeRequest(opts: any, cb: (res: unknown) => void) {
  sent.push({ opts });
  const req: any = new EventEmitter();
  req.end = () => {
    const r = reply(sent.length);
    const res: any = Readable.from([Buffer.from(r.body ?? "")]);
    res.statusCode = r.status ?? 200;
    res.headers = r.headers ?? {};
    cb(res);
  };
  return req;
}
vi.mock("node:https", () => ({ default: { Agent: class {}, request: (o: any, cb: any) => fakeRequest(o, cb) } }));
vi.mock("node:http", () => ({ default: { Agent: class {}, request: (o: any, cb: any) => fakeRequest(o, cb) } }));

import { isBlockedIp, safeFetch } from "@/lib/net/safeFetch";

const PUBLIC = [{ address: "93.184.216.34", family: 4 }];

beforeEach(() => {
  lookup.mockReset();
  lookup.mockResolvedValue(PUBLIC);
  sent.length = 0;
  reply = () => ({ body: "" });
});

const blocked = /private|Only http/;

describe("isBlockedIp", () => {
  it.each(["10.1.2.3", "127.0.0.1", "0.0.0.0", "172.16.0.1", "172.20.5.5", "172.31.255.255", "192.168.1.1", "100.64.0.1", "100.127.255.255", "169.254.169.254", "224.0.0.1", "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1"])("blocks %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });
  it.each(["93.184.216.34", "8.8.8.8", "172.15.0.1", "172.32.0.1", "100.63.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });
});

describe("safeFetch", () => {
  it("fetches a public page over a GET that carries the guarded lookup", async () => {
    reply = () => ({ body: "hello", headers: { "content-type": "text/plain" } });
    const r = await safeFetch("https://example.test/a?x=1");
    expect(r).toMatchObject({ status: 200, ok: true, text: "hello", contentType: "text/plain" });
    expect(sent[0].opts).toMatchObject({ method: "GET", hostname: "example.test", path: "/a?x=1" });
    expect(typeof sent[0].opts.lookup).toBe("function");
  });

  it("the connection's lookup refuses a private answer and passes a public one", async () => {
    await safeFetch("https://example.test/a");
    const guarded = sent[0].opts.lookup;
    lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const err = await new Promise<Error | null>((res) => guarded("rebind.test", { all: true }, (e: Error | null) => res(e)));
    expect(err?.message).toMatch(blocked);
    lookup.mockResolvedValue(PUBLIC);
    const ok = await new Promise<unknown>((res) => guarded("x.test", { all: false }, (_e: unknown, addr: string) => res(addr)));
    expect(ok).toBe("93.184.216.34");
  });

  it.each([
    "http://10.0.0.5/",
    "http://10.255.0.1:8080/x",
    "http://172.20.1.1/",
    "http://100.64.0.1/",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://2130706433/", // decimal for 127.0.0.1
    "http://0x7f.1/", // hex
    "http://localhost/",
    "http://admin.localhost/",
    "http://[::ffff:127.0.0.1]/",
  ])("refuses %s before connecting", async (url) => {
    await expect(safeFetch(url)).rejects.toThrow(blocked);
    expect(sent).toHaveLength(0);
  });

  it("refuses a name that resolves to a private address, even when only one answer is private", async () => {
    lookup.mockResolvedValue([...PUBLIC, { address: "10.0.0.9", family: 4 }]);
    await expect(safeFetch("https://rebind.example.test/")).rejects.toThrow(blocked);
  });

  it("refuses file: and ftp:", async () => {
    await expect(safeFetch("file:///etc/passwd")).rejects.toThrow(/Only http/);
    await expect(safeFetch("ftp://example.test/x")).rejects.toThrow(/Only http/);
  });

  it("checks every redirect hop and refuses one to a private host", async () => {
    reply = () => ({ status: 302, headers: { location: "http://127.0.0.1:3000/admin" } });
    await expect(safeFetch("https://example.test/go")).rejects.toThrow(blocked);
    expect(sent).toHaveLength(1);
  });

  it("follows a public redirect and stops after 3", async () => {
    reply = (n) => (n === 1 ? { status: 301, headers: { location: "/b" } } : { body: "final" });
    expect((await safeFetch("https://example.test/a")).text).toBe("final");
    sent.length = 0;
    reply = () => ({ status: 302, headers: { location: "/loop" } });
    await expect(safeFetch("https://example.test/a")).rejects.toThrow(/Too many redirects/);
  });

  it("drops Authorization on a redirect to another origin, keeps it on the same origin", async () => {
    const headers = { Authorization: "Bearer t", "User-Agent": "x" };
    reply = (n) => (n === 1 ? { status: 302, headers: { location: "https://other.test/b" } } : n === 2 ? { status: 302, headers: { location: "https://example.test/c" } } : { body: "ok" });
    await safeFetch("https://example.test/a", { headers });
    expect(sent[0].opts.headers.Authorization).toBe("Bearer t");
    expect(sent[1].opts.headers.Authorization).toBeUndefined();
    expect(sent[2].opts.headers.Authorization).toBeUndefined(); // stays off even when it comes back
    expect(sent[2].opts.headers["User-Agent"]).toBe("x");
    sent.length = 0;
    reply = (n) => (n === 1 ? { status: 302, headers: { location: "/b" } } : { body: "ok" });
    await safeFetch("https://example.test/a", { headers });
    expect(sent[1].opts.headers.Authorization).toBe("Bearer t");
  });

  it("drops Authorization on an https to http redirect of the same host (a different origin)", async () => {
    reply = (n) => (n === 1 ? { status: 302, headers: { location: "http://example.test/b" } } : { body: "ok" });
    await safeFetch("https://example.test/a", { headers: { authorization: "Bearer t" } });
    expect(sent[1].opts.headers.authorization).toBeUndefined();
  });

  it("fails on a body over the cap, or cuts it when asked to truncate", async () => {
    reply = () => ({ body: "x".repeat(5000) });
    await expect(safeFetch("https://example.test/a", { maxBytes: 1000 })).rejects.toThrow(/over/);
    const cut = await safeFetch("https://example.test/a", { maxBytes: 1000, truncate: true });
    expect(cut.text).toHaveLength(1000);
  });

  it.each([
    ["gzip", gzipSync],
    ["deflate", deflateSync],
    ["br", brotliCompressSync],
  ])("decodes %s", async (enc, pack) => {
    reply = () => ({ body: pack(Buffer.from("decoded text")), headers: { "content-encoding": enc } });
    expect((await safeFetch("https://example.test/a")).text).toBe("decoded text");
  });

  it("caps the decoded size, so a small compressed bomb is refused", async () => {
    reply = () => ({ body: gzipSync(Buffer.alloc(100_000, "a")), headers: { "content-encoding": "gzip" } });
    await expect(safeFetch("https://example.test/a", { maxBytes: 1000 })).rejects.toThrow(/over/);
  });
});
