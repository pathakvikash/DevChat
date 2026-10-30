import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { PassThrough, Writable } from "stream";
import { spawn } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { convertToModelMessages, readUIMessageStream, streamText } from "ai";
import { CLI_PROVIDERS, controlResponse, createCliModel, dropParkedRuns, parseControlRequest } from "@/lib/cliProviders";
import { helperProviderOptions, runSubAgent } from "@/lib/chat/subAgent";
import { dropRepeatedToolCalls } from "@/lib/chat/dropRepeatedToolCalls";

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

describe("two Claude Code edits in one reply", () => {
  const po = { "claude-code": { cwd: "/w", access: "ask", conversationId: "conv-two", allowedTools: [] } } as any;
  const edit = (p: string) => ({ file_path: p, old_string: "a", new_string: "b" });
  const last = async (stream: ReadableStream<any>, message?: any) => {
    let m: any;
    for await (const x of readUIMessageStream({ stream, message })) m = x;
    return m;
  };
  const answered = (msg: any, approvalId: string) => ({
    ...msg,
    parts: msg.parts.map((p: any) => (p.approval?.id === approvalId && p.state === "approval-requested" ? { ...p, state: "approval-responded", approval: { id: approvalId, approved: true } } : p)),
  });

  it("shows one row per call, the second card where the call first appeared, and answers it", async () => {
    chats.push("conv-two");
    const model = createCliModel(claude(), "default");
    const userMsg = { id: "u1", role: "user", parts: [{ type: "text", text: "edit both" }] } as any;

    const r1 = streamText({ model, messages: await convertToModelMessages([userMsg]), providerOptions: po });
    const ui1 = last(r1.toUIMessageStream({ originalMessages: [userMsg], generateMessageId: () => "a1" }));
    await until(() => spawned.length === 1);
    const c = spawned[0];
    c.say({ type: "assistant", message: { role: "assistant", content: [
      { type: "tool_use", id: "toolu_A", name: "Edit", input: edit("/w/a.txt") },
      { type: "tool_use", id: "toolu_B", name: "Edit", input: edit("/w/b.txt") },
    ] } });
    c.say(request("req_A", "toolu_A", "Edit", edit("/w/a.txt")));
    const a1 = answered(await ui1, "cli-toolu_A");

    const r2 = streamText({ model, messages: await convertToModelMessages([userMsg, a1]), providerOptions: po });
    const ui2 = last(r2.toUIMessageStream({ originalMessages: [userMsg, a1] }).pipeThrough(dropRepeatedToolCalls(a1)), a1);
    await until(() => c.written.length >= 2);
    c.say({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_A", content: "ok" }] } });
    c.say(request("req_B", "toolu_B", "Edit", edit("/w/b.txt")));
    const a2 = await ui2;
    const tools = a2.parts.filter((p: any) => p.type === "dynamic-tool");
    expect(tools.map((p: any) => [p.toolCallId, p.state])).toEqual([["toolu_A", "output-available"], ["toolu_B", "approval-requested"]]);

    const b = answered(a2, "cli-toolu_B");
    const r3 = streamText({ model, messages: await convertToModelMessages([userMsg, b]), providerOptions: po });
    const ui3 = last(r3.toUIMessageStream({ originalMessages: [userMsg, b] }).pipeThrough(dropRepeatedToolCalls(b)), b);
    await until(() => c.written.length >= 3);
    expect(c.written[2]).toBe(controlResponse("req_B", { behavior: "allow" }));
    c.say({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_B", content: "ok" }] } });
    c.say({ type: "result", subtype: "success", is_error: false, result: "done", usage: {} });
    c.exit(0);
    const a3 = await ui3;
    expect(a3.parts.filter((p: any) => p.type === "dynamic-tool").map((p: any) => [p.toolCallId, p.state])).toEqual([["toolu_A", "output-available"], ["toolu_B", "output-available"]]);
  });
});
