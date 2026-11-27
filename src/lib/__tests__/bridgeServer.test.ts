import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { PassThrough, Writable } from "stream";
import { spawn } from "child_process";
import { request, type Server } from "node:http";
import { mkdtempSync, mkdirSync, realpathSync, statSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { controlResponse } from "@/lib/cliProviders";
import { createBridgeServer, ensureConfig, main, type BridgeConfig } from "../../../scripts/bridge";

vi.mock("child_process", async (importOriginal) => ({ ...(await importOriginal<typeof import("child_process")>()), spawn: vi.fn() }));

class FakeChild extends EventEmitter {
  written: string[] = [];
  stdin = new Writable({ write: (chunk, _e, cb) => { this.written.push(String(chunk)); cb(); } });
  stdout = new PassThrough();
  stderr = new PassThrough();
  closed = false;
  kill = vi.fn(() => { this.exit(null); return true; });
  exit(code: number | null) {
    if (this.closed) return;
    this.closed = true;
    this.stdout.end();
    this.stderr.end();
    this.emit("close", code);
  }
  say(obj: unknown) { this.stdout.write(JSON.stringify(obj) + "\n"); }
  /** A short reply, then a clean exit. */
  reply(text: string) {
    this.say({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
    this.say({ type: "result", subtype: "success", is_error: false, result: text, usage: { input_tokens: 1, output_tokens: 1 } });
    this.exit(0);
  }
}

const realSetTimeout = globalThis.setTimeout;
const pause = () => new Promise<void>((r) => realSetTimeout(r, 2));
async function until(cond: () => boolean) {
  for (let i = 0; i < 2000 && !cond(); i++) await pause();
  expect(cond()).toBe(true);
}

const ORIGIN = "https://dev-chat-beta.vercel.app";
const TOKEN = "k".repeat(43);
let spawned: FakeChild[] = [];
let autoReply: string | null = "Hello from Claude";
let server: Server;
let port = 0;
let logs: string[] = [];
let folder = "";
let cfg: BridgeConfig;

beforeEach(async () => {
  spawned = [];
  vi.mocked(spawn).mockClear();
  autoReply = "Hello from Claude";
  logs = [];
  vi.mocked(spawn).mockImplementation((() => {
    const c = new FakeChild();
    spawned.push(c);
    if (autoReply) realSetTimeout(() => c.reply(autoReply!), 5);
    return c as never;
  }) as never);
  folder = realpathSync(mkdtempSync(join(tmpdir(), "bridge-folder-")));
  cfg = { token: TOKEN, origins: [ORIGIN], folders: [folder], maxMode: "ask" };
  server = createBridgeServer(() => cfg, { log: (l) => logs.push(l), findBins: async () => new Set(["claude-code"]) });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
});
afterEach(async () => {
  for (const c of spawned) c.exit(null);
  await new Promise((r) => server.close(r));
  server.closeAllConnections?.();
});

type Res = { status: number; headers: Record<string, string | string[] | undefined>; text: string };
function call(method: string, path: string, opts: { headers?: Record<string, string>; body?: unknown; raw?: string; auth?: boolean } = {}): Promise<Res> {
  const payload = opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
  const headers: Record<string, string> = {
    Origin: ORIGIN,
    ...(opts.auth === false ? {} : { Authorization: `Bearer ${TOKEN}` }),
    ...(payload !== undefined ? { "Content-Type": "application/json" } : {}),
    ...opts.headers,
  };
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      let text = "";
      res.on("data", (d) => (text += d));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, text }));
    });
    req.on("error", reject);
    req.end(payload);
  });
}

const user = (text: string) => ({ id: "u1", role: "user", parts: [{ type: "text", text }] });
const chatBody = (extra: Record<string, unknown> = {}) => ({ messages: [user("Hi")], conversationId: "c1", model: "claude-code/default", mode: "chat", folder, ...extra });
const chunks = (text: string) => text.split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]").map((l) => JSON.parse(l.slice(6)));

describe("bridge server", () => {
  it("streams text for an authorized /chat", async () => {
    const r = await call("POST", "/chat", { body: chatBody() });
    expect(r.status).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBe(ORIGIN);
    const text = chunks(r.text).filter((c) => c.type === "text-delta").map((c) => c.delta).join("");
    expect(text).toBe("Hello from Claude");
    expect(spawned).toHaveLength(1);
  });

  it("turns a permission request into tool-approval-request and resumes it on a second POST", async () => {
    autoReply = null;
    const first = call("POST", "/chat", { body: chatBody({ mode: "ask" }) });
    await until(() => spawned.length === 1);
    const c = spawned[0];
    const input = { file_path: `${folder}/a.txt` };
    c.say({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_b", name: "Edit", input }] } });
    c.say({ type: "control_request", request_id: "req_b", request: { subtype: "can_use_tool", tool_name: "Edit", input, tool_use_id: "toolu_b" } });
    const r1 = await first;
    const asked = chunks(r1.text).find((x) => x.type === "tool-approval-request");
    expect(asked.approvalId).toBe("cli-toolu_b");
    expect(c.kill).not.toHaveBeenCalled();

    const assistant = {
      id: "a1",
      role: "assistant",
      parts: [{ type: "dynamic-tool", toolName: "Edit", toolCallId: "toolu_b", providerExecuted: true, state: "approval-responded", input, approval: { id: asked.approvalId, approved: true } }],
    };
    const second = call("POST", "/chat", { body: chatBody({ mode: "ask", messages: [user("Hi"), assistant] }) });
    await until(() => c.written.length >= 2);
    expect(c.written[1]).toBe(controlResponse("req_b", { behavior: "allow" }));
    c.reply("Edited.");
    const r2 = await second;
    expect(chunks(r2.text).filter((x) => x.type === "text-delta").map((x) => x.delta).join("")).toBe("Edited.");
    expect(spawned).toHaveLength(1);
  });

  it("refuses a folder outside the list with 403 and starts nothing", async () => {
    const other = realpathSync(mkdtempSync(join(tmpdir(), "bridge-other-")));
    expect((await call("POST", "/chat", { body: chatBody({ folder: other }) })).status).toBe(403);
    expect((await call("POST", "/chat", { body: chatBody({ folder: join(folder, "..") }) })).status).toBe(403);
    expect((await call("POST", "/chat", { body: chatBody({ folder: "/definitely/not/here" }) })).status).toBe(403);
    expect(spawned).toHaveLength(0);
  });

  it("caps mode agent to ask when maxMode is ask", async () => {
    const r = await call("POST", "/chat", { body: chatBody({ mode: "agent" }) });
    expect(r.status).toBe(200);
    const argv = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(argv).toContain("--permission-prompt-tool");
    expect(argv).not.toContain("acceptEdits");
    // With maxMode agent the same request does get acceptEdits.
    cfg = { ...cfg, maxMode: "agent" };
    await call("POST", "/chat", { body: chatBody({ mode: "agent" }) });
    expect(vi.mocked(spawn).mock.calls[1][1] as string[]).toContain("acceptEdits");
  });

  it("ignores args, env, bin and other extra body fields", async () => {
    const r = await call("POST", "/chat", {
      body: chatBody({
        args: ["--dangerously-skip-permissions"],
        env: { EVIL: "1", PATH: "/evil" },
        bin: "/bin/evil",
        permissionMode: "bypassPermissions",
        addDir: "/",
        resume: "abc",
        mcpConfig: "/x.json",
        settingSources: "user",
      }),
    });
    expect(r.status).toBe(200);
    const [bin, argv, opts] = vi.mocked(spawn).mock.calls[0] as unknown as [string, string[], { env: Record<string, string>; cwd: string }];
    expect(bin).toBe("claude");
    const flat = argv.join(" ");
    for (const bad of ["dangerously", "bypassPermissions", "--add-dir", "--resume", "--mcp-config", "/bin/evil"]) expect(flat).not.toContain(bad);
    expect(argv[argv.indexOf("--setting-sources") + 1]).toBe("");
    expect(opts.env.EVIL).toBeUndefined();
    expect(opts.env.PATH).not.toBe("/evil");
    expect(opts.cwd).toBe(folder);
  });

  it("rejects an unknown model, a bad effort and a bad body with 400", async () => {
    expect((await call("POST", "/chat", { body: chatBody({ model: "claude-code/--evil" }) })).status).toBe(400);
    expect((await call("POST", "/chat", { body: chatBody({ effort: "--dangerous" }) })).status).toBe(400);
    expect((await call("POST", "/chat", { body: { model: "claude-code/default" } })).status).toBe(400);
    expect(spawned).toHaveLength(0);
  });

  it("serves /health with and without the token", async () => {
    expect(JSON.parse((await call("GET", "/health")).text)).toEqual({ protocol: 1, version: expect.any(String), claude: true });
    const bare = await call("GET", "/health", { auth: false });
    expect(bare.status).toBe(200);
    expect(JSON.parse(bare.text)).toEqual({ protocol: 1 });
    expect((await call("GET", "/health", { headers: { Authorization: "Bearer nope" } })).text).toBe('{"protocol":1}');
    // A token in the query string does not unlock it.
    expect(JSON.parse((await call("GET", `/health?token=${TOKEN}`, { auth: false })).text)).toEqual({ protocol: 1 });
  });

  it("serves /models and /folders, and needs the token for them", async () => {
    const models = JSON.parse((await call("GET", "/models")).text).models;
    expect(models.map((m: { id: string }) => m.id)).toEqual(["claude-code/default", "claude-code/sonnet", "claude-code/opus", "claude-code/haiku"]);
    expect(JSON.parse((await call("GET", "/folders")).text)).toEqual({ folders: [{ path: folder, source: "added" }], hostTools: true, reason: null });
    expect((await call("GET", "/models", { auth: false })).status).toBe(401);
    expect((await call("GET", "/folders", { auth: false })).status).toBe(401);
  });

  it("answers a preflight from an allowed origin only", async () => {
    const pre = await call("OPTIONS", "/chat", { auth: false, headers: { "Access-Control-Request-Method": "POST" } });
    expect(pre.status).toBe(204);
    expect(pre.headers["access-control-allow-private-network"]).toBe("true");
    const foreign = await call("OPTIONS", "/chat", { auth: false, headers: { Origin: "https://evil.example" } });
    expect(foreign.status).toBe(403);
    expect(foreign.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("refuses a foreign Origin and a wrong Host before parsing the body", async () => {
    // The body is not JSON: a 400 would mean it was parsed. The guard answers first.
    const foreign = await call("POST", "/chat", { raw: "{not json", headers: { Origin: "https://evil.example" } });
    expect(foreign.status).toBe(403);
    const noOrigin = await call("POST", "/chat", { raw: "{not json", headers: { Origin: "null" } });
    expect(noOrigin.status).toBe(403);
    const host = await call("POST", "/chat", { raw: "{not json", headers: { Host: `localhost:${port}` } });
    expect(host.status).toBe(403);
    const plain = await call("POST", "/chat", { raw: "{not json", headers: { "Content-Type": "text/plain" } });
    expect(plain.status).toBe(415);
    expect((await call("POST", "/chat", { raw: "{not json" })).status).toBe(400);
    expect(spawned).toHaveLength(0);
  });

  it("caps the body at 2 MB", async () => {
    const r = await call("POST", "/chat", { raw: JSON.stringify({ pad: "x".repeat(2 * 1024 * 1024 + 10) }) }).catch(() => ({ status: 413 }) as Res);
    expect(r.status).toBe(413);
  });

  it("runs at most 4 chats at once and answers 429 beyond", async () => {
    autoReply = null;
    const running = [1, 2, 3, 4].map((i) => call("POST", "/chat", { body: chatBody({ conversationId: `cc${i}` }) }));
    await until(() => spawned.length === 4);
    expect((await call("POST", "/chat", { body: chatBody({ conversationId: "cc5" }) })).status).toBe(429);
    for (const c of spawned) c.reply("done");
    expect((await Promise.all(running)).map((r) => r.status)).toEqual([200, 200, 200, 200]);
  });

  it("never writes the token to a log line", async () => {
    await call("GET", "/health");
    await call("POST", "/chat", { body: chatBody() });
    await call("GET", `/models?token=${TOKEN}`, { auth: false });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join("\n")).not.toContain(TOKEN);
  });
});

describe("bridge config", () => {
  it("creates the config with mode 0600 (dir 0700), a 256-bit token and the default origin, once", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "bridge-cfg-")), ".orrery-bridge");
    const a = ensureConfig(dir);
    expect(a.created).toBe(true);
    expect(statSync(join(dir, "config.json")).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(Buffer.from(a.config.token, "base64url")).toHaveLength(32);
    expect(a.config).toMatchObject({ origins: [ORIGIN], folders: [], maxMode: "ask" });
    const b = ensureConfig(dir);
    expect(b.created).toBe(false);
    expect(b.config.token).toBe(a.config.token);
  });

  it("--add stores the real path, refuses home, --remove drops it, and the token prints only on request", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "bridge-cfg-")), ".orrery-bridge");
    const proj = join(realpathSync(mkdtempSync(join(tmpdir(), "bridge-proj-"))), "app");
    mkdirSync(proj);
    const out: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
    try {
      await main(["--add", proj], dir);
      await expect(main(["--add", homedir()], dir)).rejects.toThrow(/too broad/);
      expect(ensureConfig(dir).config.folders).toEqual([proj]);
      await main(["--origin", "https://example.test/path"], dir);
      expect(ensureConfig(dir).config.origins).toEqual([ORIGIN, "https://example.test"]);
      await main(["--remove", proj], dir);
      expect(ensureConfig(dir).config.folders).toEqual([]);
      const token = JSON.parse(readFileSync(join(dir, "config.json"), "utf8")).token;
      expect(out.join("\n")).not.toContain(token);
      await main(["--print-token"], dir);
      expect(out.at(-1)).toBe(token);
    } finally {
      spy.mockRestore();
    }
  });
});
