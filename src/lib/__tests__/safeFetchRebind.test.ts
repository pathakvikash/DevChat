import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// A name that answers with a public address first (the early check) and 127.0.0.1 when the connection resolves it.
const answers: string[] = [];
vi.mock("node:dns", () => ({
  lookup: (_host: string, _opts: unknown, cb: (e: Error | null, a?: unknown) => void) => {
    const address = answers.shift() ?? "127.0.0.1";
    cb(null, [{ address, family: 4 }]);
  },
}));

import { safeFetch } from "@/lib/net/safeFetch";

let server: http.Server;
let hits = 0;
beforeAll(async () => {
  server = http.createServer((_req, res) => {
    hits++;
    res.end("secret");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
});
afterAll(() => new Promise((r) => server.close(r)));

describe("DNS rebinding", () => {
  it("refuses a name that is public at the check and 127.0.0.1 at the connection, without connecting", async () => {
    answers.push("93.184.216.34", "127.0.0.1");
    const port = (server.address() as AddressInfo).port;
    await expect(safeFetch(`http://rebind.example.test:${port}/`)).rejects.toThrow(/private/);
    expect(hits).toBe(0);
  });
});
