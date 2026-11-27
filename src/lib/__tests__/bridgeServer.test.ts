import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { PassThrough, Writable } from "stream";
import { spawn } from "child_process";
import { request, type Server } from "node:http";
import { mkdtempSync, mkdirSync, realpathSync, statSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { controlResponse, killAllCliRuns, setShellConfirm } from "@/lib/cliProviders";
import { ConfigMissingError, createBridgeServer, ensureConfig, main, modeNote, readConfig, startupWarning, terminalConfirm, visibleLine, type BridgeConfig } from "../../../scripts/bridge";

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
let confirmImpl = vi.fn(async (_q: { tool: string; command: string; folder: string }): Promise<boolean | "no-tty"> => true);

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
  cfg = { token: TOKEN, origins: [ORIGIN], folders: [folder], maxMode: "ask", confirmShell: true, allowChatWideEdits: false };
  confirmImpl = vi.fn(async () => true);
  server = createBridgeServer(() => cfg, { log: (l) => logs.push(l), findBins: async () => new Set(["claude-code"]), confirm: (q) => confirmImpl(q) });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
});
afterEach(async () => {
  setShellConfirm(null);
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

  it("ranks modes by risk: ask (the only one with a shell) is above agent, which is above plan", async () => {
    // maxMode agent: an ask request is lowered to agent (edits, no permission bridge, no shell).
    cfg = { ...cfg, maxMode: "agent" };
    await call("POST", "/chat", { body: chatBody({ mode: "ask" }) });
    const agentArgv = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(agentArgv).toContain("acceptEdits");
    expect(agentArgv).not.toContain("--permission-prompt-tool");
    // Agent mode has an explicit tool list and no command tools: acceptEdits would auto-allow mkdir, rm, mv, cp, sed.
    expect(agentArgv.join(" ")).not.toContain("--tools default");
    expect(agentArgv.slice(agentArgv.indexOf("--tools") + 1, agentArgv.indexOf("--tools") + 10)).toEqual(["Read", "Glob", "Grep", "Edit", "Write", "MultiEdit", "NotebookEdit", "WebSearch", "WebFetch"]);
    expect(agentArgv.slice(agentArgv.indexOf("--disallowedTools") + 1, agentArgv.indexOf("--disallowedTools") + 5)).toEqual(["Bash", "Monitor", "PowerShell", "Tmux"]);
    // maxMode plan: an agent request is lowered to plan.
    cfg = { ...cfg, maxMode: "plan" };
    await call("POST", "/chat", { body: chatBody({ mode: "agent" }) });
    const planArgv = vi.mocked(spawn).mock.calls[1][1] as string[];
    expect(planArgv).not.toContain("acceptEdits");
    expect(planArgv[planArgv.lastIndexOf("--permission-mode") + 1]).toBe("plan");
    // maxMode ask lets ask through.
    cfg = { ...cfg, maxMode: "ask" };
    await call("POST", "/chat", { body: chatBody({ mode: "ask" }) });
    expect(vi.mocked(spawn).mock.calls[2][1] as string[]).toContain("--permission-prompt-tool");
  });

  it("runs Claude Code with --strict-mcp-config", async () => {
    await call("POST", "/chat", { body: chatBody({ mode: "ask" }) });
    expect(vi.mocked(spawn).mock.calls[0][1] as string[]).toContain("--strict-mcp-config");
    await call("POST", "/chat", { body: chatBody({ mode: "chat", folder: undefined }) });
    expect(vi.mocked(spawn).mock.calls[1][1] as string[]).toContain("--strict-mcp-config");
  });

  it("ignores the page's allowedTools unless allowChatWideEdits is on", async () => {
    const ask = async () => {
      autoReply = null;
      spawned = [];
      const first = call("POST", "/chat", { body: chatBody({ mode: "ask", allowedTools: ["Edit"] }) });
      await until(() => spawned.length === 1);
      const c = spawned[0];
      const input = { file_path: `${folder}/a.txt` };
      c.say({ type: "control_request", request_id: "req_e", request: { subtype: "can_use_tool", tool_name: "Edit", input, tool_use_id: "toolu_e" } });
      return { c, first };
    };
    // Off (default): the edit still asks.
    const off = await ask();
    expect(chunks((await off.first).text).some((x) => x.type === "tool-approval-request")).toBe(true);
    // On: the same request is allowed without a card.
    cfg = { ...cfg, allowChatWideEdits: true };
    const on = await ask();
    await until(() => on.c.written.length >= 2);
    expect(on.c.written[1]).toBe(controlResponse("req_e", { behavior: "allow" }));
    on.c.reply("ok");
    expect(chunks((await on.first).text).some((x) => x.type === "tool-approval-request")).toBe(false);
  });

  describe("shell approvals are confirmed in the terminal", () => {
    /** Parks a request for `tool`, answers it as approved from the page, and returns what the daemon wrote to claude. */
    async function approveFromPage(tool: string, input: Record<string, unknown>) {
      autoReply = null;
      const first = call("POST", "/chat", { body: chatBody({ mode: "ask" }) });
      await until(() => spawned.length === 1);
      const c = spawned[0];
      c.say({ type: "control_request", request_id: "req_s", request: { subtype: "can_use_tool", tool_name: tool, input, tool_use_id: "toolu_s" } });
      const asked = chunks((await first).text).find((x) => x.type === "tool-approval-request");
      const assistant = { id: "a1", role: "assistant", parts: [{ type: "dynamic-tool", toolName: tool, toolCallId: "toolu_s", providerExecuted: true, state: "approval-responded", input, approval: { id: asked.approvalId, approved: true } }] };
      const second = call("POST", "/chat", { body: chatBody({ mode: "ask", messages: [user("Hi"), assistant] }) });
      await until(() => c.written.length >= 2);
      c.reply("done");
      await second;
      return c.written[1];
    }

    it("asks about the command and folder, and runs it only on yes", async () => {
      expect(await approveFromPage("Bash", { command: "ls -la" })).toBe(controlResponse("req_s", { behavior: "allow" }));
      expect(confirmImpl).toHaveBeenCalledWith({ tool: "Bash", command: "ls -la", folder });
    });
    it("denies when the terminal says no", async () => {
      confirmImpl = vi.fn(async () => false);
      const w = JSON.parse(await approveFromPage("Bash", { command: "rm -rf x" }));
      expect(w.response.response).toMatchObject({ behavior: "deny", message: expect.stringContaining("not confirmed") });
    });
    it("denies with a clear message when there is no terminal", async () => {
      confirmImpl = vi.fn(async () => "no-tty" as const);
      const w = JSON.parse(await approveFromPage("Bash", { command: "ls" }));
      expect(w.response.response.behavior).toBe("deny");
      expect(w.response.response.message).toMatch(/no terminal/);
    });
    it("also asks for any tool that can run code (Monitor, an unknown tool) and for an edit outside the folder or in .git", async () => {
      const cases: [string, Record<string, unknown>, string][] = [
        ["Monitor", { command: "tail -f x" }, "tail -f x"],
        ["Frobnicate", { x: 1 }, '{"x":1}'],
        ["Edit", { file_path: "/etc/hosts" }, "Edit /etc/hosts"],
        ["Write", { file_path: `${folder}/.git/hooks/pre-commit` }, `Write ${folder}/.git/hooks/pre-commit`],
      ];
      for (const [tool, input, shown] of cases) {
        spawned = [];
        confirmImpl = vi.fn(async () => false);
        const w = JSON.parse(await approveFromPage(tool, input));
        expect(confirmImpl).toHaveBeenCalledWith({ tool, command: shown, folder });
        expect(w.response.response.behavior).toBe("deny");
      }
    });

    it("denies and kills when the page leaves while the terminal waits", async () => {
      let answer!: (v: boolean) => void;
      confirmImpl = vi.fn(() => new Promise<boolean>((r) => (answer = r)));
      autoReply = null;
      const first = call("POST", "/chat", { body: chatBody({ mode: "ask" }) });
      await until(() => spawned.length === 1);
      const c = spawned[0];
      const input = { command: "ls" };
      c.say({ type: "control_request", request_id: "req_s", request: { subtype: "can_use_tool", tool_name: "Bash", input, tool_use_id: "toolu_s" } });
      const asked = chunks((await first).text).find((x) => x.type === "tool-approval-request");
      const assistant = { id: "a1", role: "assistant", parts: [{ type: "dynamic-tool", toolName: "Bash", toolCallId: "toolu_s", providerExecuted: true, state: "approval-responded", input, approval: { id: asked.approvalId, approved: true } }] };
      const req = request({ host: "127.0.0.1", port, method: "POST", path: "/chat", headers: { Origin: ORIGIN, Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } });
      req.on("error", () => undefined);
      req.end(JSON.stringify(chatBody({ mode: "ask", messages: [user("Hi"), assistant] })));
      await until(() => confirmImpl.mock.calls.length === 1);
      req.destroy();
      for (let i = 0; i < 25; i++) await pause();
      answer(true);
      await until(() => c.kill.mock.calls.length > 0);
      expect(c.written.join("")).not.toContain('"behavior":"allow"');
    });

    it("does not ask when confirmShell is off, or for an edit", async () => {
      cfg = { ...cfg, confirmShell: false };
      expect(await approveFromPage("Bash", { command: "ls" })).toBe(controlResponse("req_s", { behavior: "allow" }));
      cfg = { ...cfg, confirmShell: true };
      spawned = [];
      expect(await approveFromPage("Edit", { file_path: `${folder}/a.txt` })).toBe(controlResponse("req_s", { behavior: "allow" }));
      expect(confirmImpl).not.toHaveBeenCalled();
    });
  });

  it("kills live and parked runs on shutdown", async () => {
    autoReply = null;
    const parked = call("POST", "/chat", { body: chatBody({ mode: "ask" }) });
    await until(() => spawned.length === 1);
    spawned[0].say({ type: "control_request", request_id: "req_k", request: { subtype: "can_use_tool", tool_name: "Edit", input: { file_path: `${folder}/a.txt` }, tool_use_id: "toolu_k" } });
    await parked;
    const live = call("POST", "/chat", { body: chatBody({ conversationId: "other" }) });
    await until(() => spawned.length === 2);
    killAllCliRuns();
    expect(spawned[0].kill).toHaveBeenCalled();
    expect(spawned[1].kill).toHaveBeenCalled();
    await live.catch(() => undefined);
  });

  it("takes only text from a user message (a file or URL part is never passed on)", async () => {
    const msg = { id: "u1", role: "user", parts: [{ type: "text", text: "look" }, { type: "file", mediaType: "image/png", url: "https://evil.example/x.png" }] };
    await call("POST", "/chat", { body: chatBody({ mode: "ask", messages: [msg] }) });
    expect(spawned[0].written.join("")).toContain("look");
    expect(spawned[0].written.join("")).not.toContain("evil.example");
  });

  it("claims its slot before reading the body: slow bodies cannot exceed the cap, and a disconnect frees the slot", async () => {
    autoReply = null;
    const slow = [1, 2, 3, 4].map(() => {
      const req = request({ host: "127.0.0.1", port, method: "POST", path: "/chat", headers: { Origin: ORIGIN, Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } });
      req.on("error", () => undefined);
      req.write('{"messages":');
      return req;
    });
    // A bad body answers 400 while a slot is free and 429 once all four are held.
    const probe = async () => (await call("POST", "/chat", { raw: "{x" })).status;
    let status = 0;
    for (let i = 0; i < 200 && status !== 429; i++) {
      status = await probe();
      if (status !== 429) await pause();
    }
    expect(status).toBe(429);
    expect(spawned).toHaveLength(0);
    slow[0].destroy();
    let freed = 0;
    for (let i = 0; i < 200 && freed !== 400; i++) {
      freed = await probe();
      if (freed !== 400) await pause();
    }
    expect(freed).toBe(400);
    for (const r of slow) r.destroy();
  });

  it("survives a broken config.json: 500 with no CORS headers and one log line, then serves again", async () => {
    let broken = true;
    const lines: string[] = [];
    const s2 = createBridgeServer(
      () => {
        if (broken) throw new SyntaxError(`Unexpected token in {"token":"${TOKEN}"`);
        return cfg;
      },
      { log: (l) => lines.push(l), findBins: async () => new Set(["claude-code"]), confirm: async () => true },
    );
    await new Promise<void>((r) => s2.listen(0, "127.0.0.1", r));
    const p2 = (s2.address() as { port: number }).port;
    const get = () =>
      new Promise<{ status: number; headers: Record<string, unknown> }>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: p2, path: "/health", headers: { Origin: ORIGIN, Authorization: `Bearer ${TOKEN}` } }, (res) => {
          res.resume();
          res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers }));
        });
        req.on("error", reject);
        req.end();
      });
    const bad = await get();
    expect(bad.status).toBe(500);
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
    expect(lines.filter((l) => l.startsWith("error:"))).toHaveLength(1);
    expect(lines.join("\n")).not.toContain(TOKEN);
    broken = false;
    expect((await get()).status).toBe(200);
    await new Promise((r) => s2.close(r));
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
    expect(a.config).toMatchObject({ origins: [ORIGIN], folders: [], maxMode: "plan", confirmShell: true, allowChatWideEdits: false });
    const b = ensureConfig(dir);
    expect(b.created).toBe(false);
    expect(b.config.token).toBe(a.config.token);
  });

  it("--max-mode, --no-confirm-shell and --allow-chat-wide-edits are stored, and --max-mode prints what it allows", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "bridge-cfg-")), ".orrery-bridge");
    const out: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
    try {
      await main(["--max-mode", "agent", "--no-confirm-shell", "--allow-chat-wide-edits"], dir);
      expect(ensureConfig(dir).config).toMatchObject({ maxMode: "agent", confirmShell: false, allowChatWideEdits: true });
      expect(out).toContain(modeNote("agent"));
      await main(["--confirm-shell"], dir);
      expect(ensureConfig(dir).config.confirmShell).toBe(true);
      await expect(main(["--max-mode", "root"], dir)).rejects.toThrow(/must be one of/);
    } finally {
      spy.mockRestore();
    }
    expect(modeNote("plan")).toMatch(/read-only/);
    expect(modeNote("ask")).toMatch(/terminal/);
  });

  it("an older config without the new keys keeps its mode and gets safe defaults", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "bridge-cfg-")), ".orrery-bridge");
    ensureConfig(dir);
    const file = join(dir, "config.json");
    const old = { ...JSON.parse(readFileSync(file, "utf8")), maxMode: "ask" };
    delete old.confirmShell;
    delete old.allowChatWideEdits;
    writeFileSync(file, JSON.stringify(old));
    expect(ensureConfig(dir).config).toMatchObject({ maxMode: "ask", confirmShell: true, allowChatWideEdits: false });
  });

  it("terminalConfirm: no TTY is no-tty; y is yes; anything else and a timeout are no", async () => {
    const tty = (answer?: string) => {
      const stdin = Object.assign(new PassThrough(), { isTTY: true }) as never;
      const stdout = new PassThrough() as never;
      if (answer !== undefined) setTimeout(() => (stdin as PassThrough).write(answer + "\n"), 5);
      return { stdin, stdout };
    };
    const q = { tool: "Bash", command: "ls\u001b[2J", folder: "/p" };
    expect(await terminalConfirm({ stdin: new PassThrough() as never, stdout: new PassThrough() as never })(q)).toBe("no-tty");
    expect(await terminalConfirm(tty("yes"))(q)).toBe(true);
    expect(await terminalConfirm(tty("y"))(q)).toBe(false); // the full word, not y
    expect(await terminalConfirm(tty("n"))(q)).toBe(false);
    expect(await terminalConfirm({ ...tty(), timeoutMs: 20 })(q)).toBe(false);
  });

  it("terminalConfirm: lines typed before a question are discarded, the command is one escaped line with counts, and over 4000 characters is refused", async () => {
    const stdin = Object.assign(new PassThrough(), { isTTY: true });
    const out = new PassThrough();
    let shown = "";
    out.on("data", (d) => (shown += d));
    const ask = terminalConfirm({ stdin: stdin as never, stdout: out as never, timeoutMs: 200 });
    // First question answered; a "yes" typed afterwards, with nothing pending, must not answer the next one.
    const first = ask({ tool: "Bash", command: "echo \u202eevil\nsecond line", folder: "/p" });
    await pause();
    stdin.write("yes\n");
    expect(await first).toBe(true);
    stdin.write("yes\n");
    await pause();
    expect(await ask({ tool: "Bash", command: "ls", folder: "/p" })).toBe(false); // times out: the stray yes was dropped
    expect(shown).toContain('"echo \\u{202e}evil\\nsecond line"'); // one JSON line, format character written out
    expect(shown).toContain("(");
    expect(shown).toMatch(/\(\d+ characters, 2 lines\)/);
    expect(await ask({ tool: "Bash", command: "x".repeat(4001), folder: "/p" })).toBe("too-long");
    expect(visibleLine("a\u0085b\u200bc")).toBe('"a\\u{85}b\\u{200b}c"');
  });

  it("a config that vanishes is never recreated: readConfig throws and the daemon answers 500 once, no token minted", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "bridge-cfg-")), ".orrery-bridge");
    expect(() => readConfig(dir)).toThrow(ConfigMissingError);
    ensureConfig(dir);
    const file = join(dir, "config.json");
    const first = readConfig(dir);
    rmSync(file);
    expect(() => readConfig(dir)).toThrow(ConfigMissingError);
    expect(existsSync(file)).toBe(false); // nothing was created
    const lines: string[] = [];
    const s2 = createBridgeServer(() => readConfig(dir), { log: (l) => lines.push(l), confirm: async () => true });
    await new Promise<void>((r) => s2.listen(0, "127.0.0.1", r));
    const p2 = (s2.address() as { port: number }).port;
    const res = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      const rq = request({ host: "127.0.0.1", port: p2, path: "/health", headers: { Origin: ORIGIN, Authorization: `Bearer ${first.token}` } }, (r) => {
        let text = "";
        r.on("data", (d) => (text += d));
        r.on("end", () => resolve({ status: r.statusCode!, text }));
      });
      rq.on("error", reject);
      rq.end();
    });
    expect(res.status).toBe(500);
    expect(res.text).toContain("bridge config missing; restart the bridge");
    expect(lines.filter((l) => l.startsWith("error:"))).toEqual(["error: bridge config missing; restart the bridge"]);
    expect(existsSync(file)).toBe(false);
    await new Promise((r) => s2.close(r));
  });

  it("warns at start when the stored max mode can change files or run commands", () => {
    const base = { token: TOKEN, origins: [ORIGIN], folders: [], confirmShell: true, allowChatWideEdits: false };
    expect(startupWarning({ ...base, maxMode: "plan" })).toBeNull();
    expect(startupWarning({ ...base, maxMode: "chat" })).toBeNull();
    const ask = startupWarning({ ...base, maxMode: "ask" })!;
    expect(ask).toContain("Max mode ask");
    expect(ask).toContain("shell commands");
    expect(ask).not.toContain("\n");
    expect(startupWarning({ ...base, maxMode: "agent" })).toContain("Max mode agent");
    expect(modeNote("agent")).toMatch(/package\.json scripts.*git hooks/);
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
