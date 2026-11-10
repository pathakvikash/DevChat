import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { PassThrough, Writable } from "stream";
import { spawn } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { convertToModelMessages, lastAssistantMessageIsCompleteWithApprovalResponses, readUIMessageStream, streamText } from "ai";
import { CLI_PROVIDERS, controlResponse, createCliModel, dropParkedRuns, parseControlRequest } from "@/lib/cliProviders";
import { helperProviderOptions, runSubAgent } from "@/lib/chat/subAgent";
import { groupToolParts } from "@/lib/utils/messageParts";

vi.mock("child_process", async (importOriginal) => ({ ...(await importOriginal<typeof import("child_process")>()), spawn: vi.fn() }));

class FakeChild extends EventEmitter {
  written: string[] = [];
  stdin = new Writable({ write: (c, _e, cb) => { this.written.push(String(c)); cb(); } });
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
  say(o: unknown) { this.stdout.write(JSON.stringify(o) + "\n"); }
}

const realSetTimeout = globalThis.setTimeout;
const pause = () => new Promise<void>((r) => realSetTimeout(r, 2));
async function until(cond: () => boolean) {
  for (let i = 0; i < 2000 && !cond(); i++) await pause();
  expect(cond()).toBe(true);
}

let spawned: FakeChild[] = [];
let chats: string[] = [];
let dirs: string[] = [];
beforeEach(() => {
  spawned = [];
  vi.mocked(spawn).mockImplementation(() => { const c = new FakeChild(); spawned.push(c); return c as any; });
});
afterEach(() => {
  for (const id of chats) dropParkedRuns(id);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  chats = [];
  dirs = [];
});

const claude = () => CLI_PROVIDERS.find((d) => d.id === "claude-code")!;
const DENY = (id: string) => controlResponse(id, { behavior: "deny", message: "The user denied this action." });
const user = [{ role: "user", content: [{ type: "text", text: "go" }] }] as any;
const answerPrompt = (approvalId: string, approved: boolean) =>
  [
    ...user,
    { role: "assistant", content: [{ type: "tool-call", toolCallId: approvalId.replace("cli-", ""), toolName: "Bash", input: {}, providerExecuted: true }, { type: "tool-approval-request", approvalId, toolCallId: approvalId.replace("cli-", "") }] },
    { role: "tool", content: [{ type: "tool-approval-response", approvalId, approved }] },
  ] as any;

async function readAll(stream: ReadableStream<any>) {
  const out: any[] = [];
  const r = stream.getReader();
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

interface Opts { cwd?: string; access?: string; allowedTools?: string[]; userId?: string }
async function start(conversationId: string, prompt: any, o: Opts = {}) {
  chats.push(conversationId);
  const { stream } = await createCliModel(claude(), "default").doStream({
    prompt,
    providerOptions: { "claude-code": { cwd: o.cwd ?? "/w", access: o.access ?? "ask", conversationId, allowedTools: o.allowedTools ?? [], ...(o.userId ? { userId: o.userId } : {}) } },
    tools: [],
  } as any);
  return stream;
}

const request = (requestId: string, toolUseId: string, toolName: string, input: unknown, extra: Record<string, unknown> = {}) => ({
  type: "control_request",
  request_id: requestId,
  request: { subtype: "can_use_tool", tool_name: toolName, input, tool_use_id: toolUseId, ...extra },
});

/** Starts a request that spawns a new child; resolves with the child and the stream's parts once it ends. */
async function spawnNew(conversationId: string, prompt: any, o: Opts = {}) {
  const before = spawned.length;
  const reading = readAll(await start(conversationId, prompt, o));
  await until(() => spawned.length > before);
  return { c: spawned[before], parts: reading };
}

/** A card for `toolUseId` is parked in `conversationId`; its child is returned. */
async function park(conversationId: string, toolUseId: string, o: Opts = {}) {
  const { c, parts } = await spawnNew(conversationId, user, o);
  c.say(request(`req_${toolUseId}`, toolUseId, "Bash", { command: "make" }));
  await parts;
  return c;
}

function tmpFolder() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "bridge-")));
  dirs.push(dir);
  mkdirSync(join(dir, ".git", "hooks"), { recursive: true });
  mkdirSync(join(dir, ".claude"), { recursive: true });
  mkdirSync(join(dir, "src"), { recursive: true });
  return dir;
}

describe("allow for this chat does not leave the working folder", () => {
  /** Sends one Edit request to an Ask run that has Edit allowed for the chat; true when it was answered without a card. */
  async function autoAllowed(cwd: string, input: unknown, extra: Record<string, unknown> = {}) {
    const { c, parts } = await spawnNew(`scope-${chats.length}`, user, { cwd, allowedTools: ["Edit", "Write"] });
    let ended = false;
    void parts.then(() => (ended = true));
    c.say(request("req_e", "toolu_e", "Edit", input, extra));
    await until(() => c.written.length >= 2 || ended);
    const allowed = c.written[1] === controlResponse("req_e", { behavior: "allow" });
    if (allowed) c.exit(0);
    expect((await parts).some((p) => p.type === "tool-approval-request")).toBe(!allowed);
    return allowed;
  }

  it("answers an edit inside the folder without a card", async () => {
    const dir = tmpFolder();
    expect(await autoAllowed(dir, { file_path: join(dir, "src", "a.ts"), old_string: "a", new_string: "b" })).toBe(true);
    expect(await autoAllowed(dir, { file_path: join(dir, "src", "new.ts") })).toBe(true);
  });

  it("shows the card for a shell rc file, however Claude Code flags it or not", async () => {
    const dir = tmpFolder();
    expect(await autoAllowed(dir, { file_path: "/Users/v/.zshrc" })).toBe(false);
    expect(await autoAllowed(dir, { file_path: "/Users/v/.ssh/authorized_keys" })).toBe(false);
    mkdirSync(join(dir, "~"));
    expect(await autoAllowed(dir, { file_path: "~/.zshrc" })).toBe(false);
  });

  it("shows the card when Claude Code names a blocked path or gives a reason", async () => {
    const dir = tmpFolder();
    const input = { file_path: join(dir, "src", "a.ts") };
    expect(await autoAllowed(dir, input, { blocked_path: join(dir, "src", "a.ts") })).toBe(false);
    expect(await autoAllowed(dir, input, { decision_reason_type: "safetyCheck" })).toBe(false);
    expect(await autoAllowed(dir, input, { decision_reason: { type: "other" } })).toBe(false);
  });

  it("shows the card for .git hooks, .claude settings and a symlink out of the folder", async () => {
    const dir = tmpFolder();
    symlinkSync(tmpdir(), join(dir, "escape"));
    expect(await autoAllowed(dir, { file_path: join(dir, ".git", "hooks", "pre-commit") })).toBe(false);
    expect(await autoAllowed(dir, { file_path: join(dir, ".claude", "settings.json") })).toBe(false);
    expect(await autoAllowed(dir, { file_path: join(dir, ".husky", "pre-commit") })).toBe(false);
    expect(await autoAllowed(dir, { file_path: join(dir, "escape", "x") })).toBe(false);
  });

  it("reads blocked_path and decision_reason* off the request, and nothing off an ordinary one", () => {
    const line = (extra: Record<string, unknown>) => JSON.stringify(request("r", "t", "Edit", {}, extra));
    expect(parseControlRequest(line({}))?.flagged).toBeUndefined();
    expect(parseControlRequest(line({ blocked_path: "/x" }))?.flagged).toBe(true);
    expect(parseControlRequest(line({ decision_reason_type: "safetyCheck" }))?.flagged).toBe(true);
    expect(parseControlRequest(line({ decision_reason: null }))?.flagged).toBeUndefined();
  });
});

describe("an answer from outside Ask never resumes the Ask process", () => {
  for (const access of ["chat", "plan", "agent"]) {
    for (const approved of [false, true]) {
      it(`${approved ? "Allow" : "Deny"} in ${access} denies and closes it, and no later Edit is allowed`, async () => {
        const c = await park(`mode-${access}-${approved}`, "toolu_b", { allowedTools: ["Edit"] });
        const parts = await readAll(await start(`mode-${access}-${approved}`, answerPrompt("cli-toolu_b", approved), { access, allowedTools: ["Edit"] }));
        expect(parts.some((p) => p.type === "error")).toBe(true);
        expect(c.written.at(-1)).toBe(DENY("req_toolu_b"));
        expect(c.kill).toHaveBeenCalled();
        expect(c.written.some((w) => w.includes('"behavior":"allow"'))).toBe(false);
        // It is forgotten: a second answer finds nothing to resume.
        const again = await readAll(await start(`mode-${access}-${approved}`, answerPrompt("cli-toolu_b", true), {}));
        expect(again.some((p) => p.type === "error" && /expired/.test(String(p.error?.message)))).toBe(true);
      });
    }
  }

  it("ignores the allow list when the request is not in Ask, so even a stray permission request gets a card", async () => {
    const dir = tmpFolder();
    const { c, parts } = await spawnNew("mode-stray", user, { cwd: dir, access: "chat", allowedTools: ["Edit"] });
    c.say(request("req_x", "toolu_x", "Edit", { file_path: join(dir, "a.ts") }));
    expect((await parts).some((p) => p.type === "tool-approval-request")).toBe(true);
    expect(c.written.some((w) => w.includes('"behavior":"allow"'))).toBe(false);
  });

  it("still resumes with Deny from Ask", async () => {
    const c = await park("mode-ask", "toolu_d");
    const reading = readAll(await start("mode-ask", answerPrompt("cli-toolu_d", false)));
    await until(() => c.written.length >= 2);
    expect(c.written[1]).toBe(DENY("req_toolu_d"));
    expect(c.kill).not.toHaveBeenCalled();
    c.exit(0);
    await reading;
  });
});

describe("parked runs are bounded", () => {
  it("keeps two per user: a third closes the user's oldest", async () => {
    const first = await park("cap-u-1", "toolu_1", { userId: "u1" });
    const second = await park("cap-u-2", "toolu_2", { userId: "u1" });
    expect(first.kill).not.toHaveBeenCalled();
    const third = await park("cap-u-3", "toolu_3", { userId: "u1" });
    expect(first.written.at(-1)).toBe(DENY("req_toolu_1"));
    expect(first.kill).toHaveBeenCalled();
    expect(second.kill).not.toHaveBeenCalled();
    expect(third.kill).not.toHaveBeenCalled();
    // Another user is not counted against u1.
    const other = await park("cap-u-4", "toolu_4", { userId: "u2" });
    expect(other.kill).not.toHaveBeenCalled();
    expect(second.kill).not.toHaveBeenCalled();
  });

  it("keeps eight overall: a ninth closes the oldest of anyone", async () => {
    const kids = [];
    for (let n = 0; n < 8; n++) kids.push(await park(`cap-all-${n}`, `toolu_all_${n}`, { userId: `user-${Math.floor(n / 2)}` }));
    expect(kids.some((k) => k.kill.mock.calls.length > 0)).toBe(false);
    kids.push(await park("cap-all-8", "toolu_all_8", { userId: "user-9" }));
    expect(kids[0].kill).toHaveBeenCalled();
    expect(kids.slice(1).some((k) => k.kill.mock.calls.length > 0)).toBe(false);
  });

  it("holds the map on globalThis so a hot reload does not orphan the children", async () => {
    await park("cap-global", "toolu_g");
    const shared = (globalThis as any).__devchatParkedRuns as Map<string, unknown>;
    expect(shared).toBeInstanceOf(Map);
    expect(shared.has("cli-toolu_g")).toBe(true);
  });
});

describe("helpers in Ask and Plan only read", () => {
  const parent = { "claude-code": { cwd: "/w", access: "ask", conversationId: "parent-1", allowedTools: ["Edit"], effort: "" } } as any;

  it("rewrites CLI options for every mode but Agent, and leaves other providers' options alone", () => {
    for (const mode of ["chat", "plan", "ask"] as const) {
      expect(helperProviderOptions(parent, mode)).toEqual({ "claude-code": { cwd: "/w", access: "chat", conversationId: "", allowedTools: [], effort: "" } });
    }
    expect(helperProviderOptions(parent, "agent")).toBe(parent);
    const ollama = { ollama: { num_ctx: 4096 } } as any;
    expect(helperProviderOptions(ollama, "ask")).toEqual(ollama);
    expect(helperProviderOptions(undefined, "ask")).toBeUndefined();
  });

  it("starts Claude Code without the permission bridge and with read-only tools", async () => {
    const ac = new AbortController();
    const run = runSubAgent({
      brief: "look around", mode: "ask", workingFolder: "/w", tools: {}, abortSignal: ac.signal, timeoutMs: 20000,
      model: { model: createCliModel(claude(), "default"), supportsTools: true, maxTokens: 1000 } as any,
      providerOptions: parent,
    });
    await until(() => spawned.length === 1);
    const args = vi.mocked(spawn).mock.calls.at(-1)![1] as string[];
    expect(args).not.toContain("--permission-prompt-tool");
    expect(args).not.toContain("acceptEdits");
    expect(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 5)).toEqual(["--tools", "Read", "Glob", "Grep", "WebSearch"]);
    spawned[0].say({ type: "result", subtype: "success", is_error: false, result: "done", usage: {} });
    spawned[0].exit(0);
    await run;
  });
});

describe("two Claude Code cards in one reply, through the AI SDK", () => {
  const read = (p: string) => ({ file_path: p });
  const last = async (stream: ReadableStream<any>, message?: any) => {
    let m: any;
    for await (const x of readUIMessageStream({ stream, message })) m = x;
    return m;
  };
  const answered = (msg: any, approvalId: string, approved = true) => ({
    ...msg,
    parts: msg.parts.map((p: any) => (p.approval?.id === approvalId && p.state === "approval-requested" ? { ...p, state: "approval-responded", approval: { id: approvalId, approved } } : p)),
  });
  const ask = (tid: string) => request(`req_${tid}`, `toolu_${tid}`, "Read", read(`/etc/${tid}`));

  /** Request 1 announces A and B and asks for `first`; each answer goes through the SDK as the browser would send it. */
  async function twoCards(conv: string, order: "AB" | "BA", textBetween: boolean, answerSecond: (id: string) => boolean = () => true) {
    chats.push(conv);
    const po = { "claude-code": { cwd: "/w", access: "ask", conversationId: conv, allowedTools: [] } } as any;
    const model = createCliModel(claude(), "default");
    const userMsg = { id: "u1", role: "user", parts: [{ type: "text", text: "read both" }] } as any;
    const [x, y] = order.split("");
    const before = spawned.length;

    const r1 = streamText({ model, messages: await convertToModelMessages([userMsg]), providerOptions: po });
    const ui1 = last(r1.toUIMessageStream({ originalMessages: [userMsg], generateMessageId: () => "a1" }));
    await until(() => spawned.length > before);
    const c = spawned[before];
    c.say({ type: "assistant", message: { role: "assistant", content: [
      { type: "tool_use", id: "toolu_A", name: "Read", input: read("/etc/A") },
      { type: "tool_use", id: "toolu_B", name: "Read", input: read("/etc/B") },
    ] } });
    c.say(ask(x));
    if (!textBetween) c.say(ask(y));
    const m1 = answered(await ui1, `cli-toolu_${x}`);

    const r2 = streamText({ model, messages: await convertToModelMessages([userMsg, m1]), providerOptions: po });
    const ui2 = last(r2.toUIMessageStream({ originalMessages: [userMsg, m1] }), m1);
    await until(() => c.written.length >= 2);
    if (textBetween) {
      c.say({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: `${x} is done; now ${y}.` }] } });
      c.say(ask(y));
    }
    const asked = await ui2;
    const m2 = answered(asked, `cli-toolu_${y}`, answerSecond(y));
    return { c, userMsg, asked, m2, x, y, po, model, sent: lastAssistantMessageIsCompleteWithApprovalResponses({ messages: [userMsg, m2] }) };
  }

  const cases: Array<[string, "AB" | "BA", boolean]> = [
    ["asked one after the other", "AB", false],
    ["asked together, the later one first", "BA", false],
    ["with text between the asks", "AB", true],
  ];
  for (const [name, order, textBetween] of cases) {
    it(`answering the second card sends, and resumes that card (${name})`, async () => {
      const { c, userMsg, asked, m2, x, y, po, model, sent } = await twoCards(`two-${name}`, order, textBetween);
      // The browser sends the reply on its own only when the last step holds a finished approval.
      expect(sent).toBe(true);
      // The first card was answered with its own request; the second is still waiting for the answer.
      expect(c.written[1]).toBe(controlResponse(`req_${x}`, { behavior: "allow" }));
      // The card shows once, and it is the one that waits.
      const calls = asked.parts.filter((p: any) => p.type === "dynamic-tool").map((p: any) => ({ ...p, type: `tool-${p.toolName}` }));
      const groups = groupToolParts(calls).filter((g) => g.type === "tool-group") as any[];
      expect(groups.map((g) => g.key).sort()).toEqual(["toolu_A", "toolu_B"]);
      expect(groups.find((g) => g.key === `toolu_${y}`).parts.map((p: any) => p.state)).toEqual(["approval-requested"]);

      const r3 = streamText({ model, messages: await convertToModelMessages([userMsg, m2]), providerOptions: po });
      const reading = (async () => { for await (const ch of r3.fullStream) if (ch.type === "error") throw ch.error; })();
      await until(() => c.written.length >= 3);
      expect(c.written[2]).toBe(controlResponse(`req_${y}`, { behavior: "allow" }));
      expect(spawned).toHaveLength(1);
      expect(c.kill).not.toHaveBeenCalled();
      c.say({ type: "result", subtype: "success", is_error: false, result: "ok", usage: {} });
      c.exit(0);
      await reading;
    });
  }

  it("a Deny on the second card reaches that card, and the process stays for the model to read it", async () => {
    const { c, userMsg, m2, y, po, model, sent } = await twoCards("two-deny", "AB", true, () => false);
    expect(sent).toBe(true);
    const r3 = streamText({ model, messages: await convertToModelMessages([userMsg, m2]), providerOptions: po });
    const reading = (async () => { for await (const ch of r3.fullStream) if (ch.type === "error") throw ch.error; })();
    await until(() => c.written.length >= 3);
    expect(c.written[2]).toBe(DENY(`req_${y}`));
    expect(c.kill).not.toHaveBeenCalled();
    c.say({ type: "result", subtype: "success", is_error: false, result: "ok", usage: {} });
    c.exit(0);
    await reading;
  });

  it("when one message holds several answers, the one for the parked card resolves, in either order", async () => {
    for (const [conv, order] of [["multi-1", ["cli-toolu_old", "cli-toolu_new"]], ["multi-2", ["cli-toolu_new", "cli-toolu_old"]]] as const) {
      const c = await park(conv, "toolu_new");
      const prompt = [
        ...user,
        { role: "assistant", content: [{ type: "tool-call", toolCallId: "toolu_new", toolName: "Bash", input: {}, providerExecuted: true }] },
        { role: "tool", content: order.map((approvalId) => ({ type: "tool-approval-response", approvalId, approved: true })) },
      ] as any;
      const reading = readAll(await start(conv, prompt));
      await until(() => c.written.length >= 2);
      expect(c.written[1]).toBe(controlResponse("req_toolu_new", { behavior: "allow" }));
      expect(c.kill).not.toHaveBeenCalled();
      c.exit(0);
      await reading;
    }
  });
});

describe("a CLI run's process", () => {
  const def = (id: string) => CLI_PROVIDERS.find((d) => d.id === id)!;
  async function run(d: ReturnType<typeof def>, po: Record<string, unknown> = {}) {
    const { stream } = await createCliModel(d, "default").doStream({ prompt: user, providerOptions: { [d.id]: po }, tools: [] } as any);
    return stream;
  }
  /** The options `spawn` was last called with. */
  const spawnOpts = () => vi.mocked(spawn).mock.calls.at(-1)![2] as { cwd: string; env: NodeJS.ProcessEnv };

  it("gets PWD equal to the cwd it is spawned in, with a folder or without", async () => {
    for (const [po, cwd] of [[{}, join(tmpdir(), "devchat-cli")], [{ cwd: "/w", access: "chat" }, "/w"]] as const) {
      const before = spawned.length;
      const reading = readAll(await run(def("opencode"), po));
      await until(() => spawned.length > before);
      expect(spawnOpts().cwd).toBe(cwd);
      expect(spawnOpts().env.PWD).toBe(cwd);
      spawned[before].exit(0);
      await reading;
    }
  });

  it("refuses Codex without a working folder, and runs it inside one", async () => {
    const before = spawned.length;
    const parts = await readAll(await run(def("codex")));
    expect(spawned.length).toBe(before);
    expect(parts.find((p) => p.type === "error")?.error.message).toMatch(/Codex needs a working folder/);
    const reading = readAll(await run(def("codex"), { cwd: "/w", access: "chat" }));
    await until(() => spawned.length > before);
    expect(vi.mocked(spawn).mock.calls.at(-1)![1]).toEqual(expect.arrayContaining(["--sandbox", "read-only", "-C", "/w"]));
    spawned[before].exit(0);
    await reading;
  });

  describe("watchdog", () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] }));
    afterEach(() => vi.useRealTimers());

    /** Starts a silent run of `d` and lets `ms` pass; returns the child and what the stream said. */
    async function silentFor(d: ReturnType<typeof def>, ms: number) {
      const before = spawned.length;
      const reading = readAll(await run(d, { cwd: "/w", access: "chat" }));
      await until(() => spawned.length > before);
      vi.advanceTimersByTime(ms);
      return { c: spawned[before], reading };
    }

    it("stops a silent Claude Code run after 120s and says so", async () => {
      const { c, reading } = await silentFor(def("claude-code"), 125_000);
      expect(c.kill).toHaveBeenCalled();
      expect((await reading).find((p) => p.type === "error")?.error.message).toMatch(/produced no output for 120s/);
    });

    it("lets OpenCode stay silent through a long sub-agent, and stops it after 15 minutes", async () => {
      const { c, reading } = await silentFor(def("opencode"), 600_000);
      expect(c.kill).not.toHaveBeenCalled();
      vi.advanceTimersByTime(310_000);
      expect(c.kill).toHaveBeenCalled();
      expect((await reading).find((p) => p.type === "error")?.error.message).toMatch(/produced no output for 900s/);
    });
  });

  it("cuts a long tool result to 8000 characters, whichever CLI ran the tool", async () => {
    const before = spawned.length;
    const reading = readAll(await run(def("claude-code"), { cwd: "/w", access: "chat" }));
    await until(() => spawned.length > before);
    const c = spawned[before];
    c.say({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }] } });
    c.say({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "x".repeat(20_000) }] } });
    c.say({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: "short" }] } });
    // Text blocks: joined, so the cut result is plain text, not JSON with escaped quotes and newlines.
    const blocks = [{ type: "text", text: `a "quoted"\n${"y".repeat(5_000)}` }, { type: "text", text: "z".repeat(5_000) }];
    c.say({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t3", content: blocks }] } });
    c.say({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t4", content: [{ type: "text", text: "small" }] }] } });
    c.exit(0);
    const results = (await reading).filter((p) => p.type === "tool-result");
    expect(results[0].result).toBe(`${"x".repeat(8_000)}\n[…truncated]`);
    expect(results[1].result).toBe("short");
    expect(results[2].result).toBe(`${blocks.map((b) => b.text).join("\n").slice(0, 8_000)}\n[…truncated]`);
    expect(results[3].result).toEqual([{ type: "text", text: "small" }]); // under the cap: as it came
  });
});
