import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { PassThrough, Writable } from "stream";
import { spawn } from "child_process";
import {
  CLI_PROVIDERS,
  claudeParser,
  controlResponse,
  createCliModel,
  parseControlRequest,
  userMessageLine,
} from "@/lib/cliProviders";

vi.mock("child_process", async (importOriginal) => ({ ...(await importOriginal<typeof import("child_process")>()), spawn: vi.fn() }));

// Real `can_use_tool` request from the permission spike (Claude Code 2.1.296).
const SPIKE_CONTROL_REQUEST = `{"type":"control_request","request_id":"897265a1-c43e-45cf-a72f-c2a75bd6bdda","request":{"subtype":"can_use_tool","tool_name":"Edit","display_name":"Edit","input":{"file_path":"/w/dummy.txt","old_string":"alpha\\n","new_string":"alpha\\nhello from spike\\n","replace_all":false},"description":"dummy.txt","permission_suggestions":[{"type":"setMode","mode":"acceptEdits","destination":"session"}],"tool_use_id":"toolu_016thLzi3M6Z2Uo7HBgGfzLK"}}`;

describe("can_use_tool parser and control_response writer", () => {
  it("reads the request from the spike's exact line", () => {
    expect(parseControlRequest(SPIKE_CONTROL_REQUEST)).toEqual({
      requestId: "897265a1-c43e-45cf-a72f-c2a75bd6bdda",
      toolUseId: "toolu_016thLzi3M6Z2Uo7HBgGfzLK",
      toolName: "Edit",
      input: { file_path: "/w/dummy.txt", old_string: "alpha\n", new_string: "alpha\nhello from spike\n", replace_all: false },
    });
    expect(parseControlRequest(`{"type":"control_request","request_id":"r","request":{"subtype":"initialize"}}`)).toBeNull();
    expect(claudeParser()(SPIKE_CONTROL_REQUEST)).toEqual([
      expect.objectContaining({ type: "permission", requestId: "897265a1-c43e-45cf-a72f-c2a75bd6bdda", toolName: "Edit" }),
    ]);
  });

  it("writes allow and deny in the spike's exact shape", () => {
    expect(controlResponse("r1", { behavior: "allow" })).toBe(
      `{"type":"control_response","response":{"subtype":"success","request_id":"r1","response":{"behavior":"allow"}}}\n`,
    );
    expect(controlResponse("r1", { behavior: "deny", message: "The user denied this action." })).toBe(
      `{"type":"control_response","response":{"subtype":"success","request_id":"r1","response":{"behavior":"deny","message":"The user denied this action."}}}\n`,
    );
  });

  it("starts Ask with a folder on stream-json and the stdio permission tool, and keeps the default mode", () => {
    const def = CLI_PROVIDERS.find((d) => d.id === "claude-code")!;
    const spec = def.invoke({ model: "default", system: "", user: "hi", cwd: "/w", access: "ask" });
    expect(spec.args).toEqual(expect.arrayContaining(["--input-format", "stream-json", "--permission-prompt-tool", "stdio"]));
    expect(spec.args).toEqual(expect.arrayContaining(["--permission-mode", "default", "--tools", "default"]));
    expect(spec.args).not.toContain("bypassPermissions");
    expect(spec.holdStdin).toBe(true);
    expect(spec.stdin).toBe(userMessageLine("hi"));
    expect(userMessageLine("hi")).toBe(`{"type":"user","message":{"role":"user","content":"hi"}}\n`);
    // Without a folder Ask is Chat: no tools, no bridge.
    const sandboxed = def.invoke({ model: "default", system: "", user: "hi", access: "ask" });
    expect(sandboxed.args).not.toContain("--permission-prompt-tool");
    expect(sandboxed.holdStdin).toBeFalsy();
  });
});

/** A child process the tests drive line by line. */
class FakeChild extends EventEmitter {
  written: string[] = [];
  stdin = new Writable({
    write: (chunk, _enc, cb) => {
      this.written.push(String(chunk));
      cb();
    },
  });
  stdout = new PassThrough();
  stderr = new PassThrough();
  closed = false;
  kill = vi.fn(() => {
    this.exit(null);
    return true;
  });
  exit(code: number | null) {
    if (this.closed) return;
    this.closed = true;
    this.stdout.end();
    this.stderr.end();
    this.emit("close", code);
  }
  say(obj: unknown) {
    this.stdout.write(JSON.stringify(obj) + "\n");
  }
}

const realSetTimeout = globalThis.setTimeout;
const pause = () => new Promise<void>((r) => realSetTimeout(r, 2));
async function until(cond: () => boolean) {
  for (let i = 0; i < 2000 && !cond(); i++) await pause();
  expect(cond()).toBe(true);
}

let spawned: FakeChild[] = [];
const def = () => CLI_PROVIDERS.find((d) => d.id === "claude-code")!;
const prompt = (text = "Edit the file") => [{ role: "user", content: [{ type: "text", text }] }] as any;
const toolUse = (id: string, name: string) => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "tool_use", id, name, input: { file_path: "/w/a.txt" } }] },
});
const askRequest = (requestId: string, toolUseId: string, toolName = "Edit") => ({
  type: "control_request",
  request_id: requestId,
  request: { subtype: "can_use_tool", tool_name: toolName, input: { file_path: "/w/a.txt" }, tool_use_id: toolUseId },
});
const resultLine = { type: "result", subtype: "success", is_error: false, result: "done", usage: { input_tokens: 1, output_tokens: 1 } };
/** The next request: the prompt ends with the user's answer to an approval. */
const answerPrompt = (approvalId: string, approved: boolean) =>
  [
    { role: "user", content: [{ type: "text", text: "Edit the file" }] },
    {
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: approvalId.replace("cli-", ""), toolName: "Edit", input: {}, providerExecuted: true },
        { type: "tool-approval-request", approvalId, toolCallId: approvalId.replace("cli-", "") },
      ],
    },
    { role: "tool", content: [{ type: "tool-approval-response", approvalId, approved }] },
  ] as any;

async function start(p: any, access: string, cwd = "/w", conversationId: string, allowedTools: string[] = [], signal?: AbortSignal) {
  const model = createCliModel(def(), "default");
  const opts = { "claude-code": { cwd, access, conversationId, allowedTools } };
  const { stream } = await model.doStream({ prompt: p, providerOptions: opts, tools: [], abortSignal: signal } as any);
  return stream;
}
async function readAll(stream: ReadableStream<any>) {
  const out: any[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

beforeEach(() => {
  spawned = [];
  vi.mocked(spawn).mockImplementation(() => {
    const c = new FakeChild();
    spawned.push(c);
    return c as any;
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Ask bridge: park and resume", () => {
  it("ends the request on the permission card, then answers the parked process and reads on", async () => {
    const first = await start(prompt(), "ask", "/w", "conv-park");
    const firstParts = readAll(first);
    await until(() => spawned.length === 1);
    const c = spawned[0];
    c.say(toolUse("toolu_park", "Edit"));
    c.say(askRequest("req_park", "toolu_park"));
    const parts = await firstParts;
    expect(parts).toContainEqual({ type: "tool-approval-request", approvalId: "cli-toolu_park", toolCallId: "toolu_park" });
    expect(parts.at(-1)).toMatchObject({ type: "finish", finishReason: { unified: "tool-calls" } });
    expect(c.kill).not.toHaveBeenCalled();
    expect(c.written[0]).toBe(userMessageLine("Edit the file"));

    const second = await start(answerPrompt("cli-toolu_park", true), "ask", "/w", "conv-park");
    const secondParts = readAll(second);
    await until(() => c.written.length >= 2);
    expect(c.written[1]).toBe(controlResponse("req_park", { behavior: "allow" }));
    c.say(resultLine);
    c.exit(0);
    const done = await secondParts;
    expect(done.some((p) => p.type === "tool-approval-request")).toBe(false);
    expect(done.at(-1)).toMatchObject({ type: "finish", finishReason: { unified: "stop" } });
  });

  it("answers Deny with the deny message the model reads", async () => {
    const first = await start(prompt(), "ask", "/w", "conv-deny");
    const firstParts = readAll(first);
    await until(() => spawned.length === 1);
    const c = spawned[0];
    c.say(toolUse("toolu_deny", "Bash"));
    c.say(askRequest("req_deny", "toolu_deny", "Bash"));
    await firstParts;
    const second = await start(answerPrompt("cli-toolu_deny", false), "ask", "/w", "conv-deny");
    const secondParts = readAll(second);
    await until(() => c.written.length >= 2);
    expect(c.written[1]).toBe(controlResponse("req_deny", { behavior: "deny", message: "The user denied this action." }));
    c.exit(0);
    await secondParts;
  });

  it("honours the chat's allow-for-chat list on the next request without a card", async () => {
    const stream = await start(prompt(), "ask", "/w", "conv-allow", ["Edit"]);
    const parts = readAll(stream);
    await until(() => spawned.length === 1);
    const c = spawned[0];
    c.say(toolUse("toolu_allow", "Edit"));
    c.say(askRequest("req_allow", "toolu_allow"));
    await until(() => c.written.length >= 2);
    expect(c.written[1]).toBe(controlResponse("req_allow", { behavior: "allow" }));
    c.say(resultLine);
    c.exit(0);
    const out = await parts;
    expect(out.some((p) => p.type === "tool-approval-request")).toBe(false);
  });

  it("denies and closes a card left open past the limit", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    const first = await start(prompt(), "ask", "/w", "conv-ttl");
    const parts = readAll(first);
    await until(() => spawned.length === 1);
    const c = spawned[0];
    c.say(toolUse("toolu_ttl", "Edit"));
    c.say(askRequest("req_ttl", "toolu_ttl"));
    await parts;
    vi.advanceTimersByTime(15 * 60_000 + 1);
    expect(c.written.at(-1)).toBe(
      controlResponse("req_ttl", { behavior: "deny", message: "The user denied this action." }),
    );
    expect(c.kill).toHaveBeenCalled();
  });

  it("denies and closes the parked run when the chat sends again", async () => {
    const first = await start(prompt(), "ask", "/w", "conv-moved");
    const parts = readAll(first);
    await until(() => spawned.length === 1);
    const c = spawned[0];
    c.say(toolUse("toolu_moved", "Edit"));
    c.say(askRequest("req_moved", "toolu_moved"));
    await parts;
    // A new request for the same chat that does not answer the card.
    const next = await start(prompt("Something else"), "ask", "/w", "conv-moved");
    const nextParts = readAll(next);
    await until(() => spawned.length === 2);
    spawned[1].exit(0);
    await nextParts;
    expect(c.written.at(-1)).toBe(controlResponse("req_moved", { behavior: "deny", message: "The user denied this action." }));
    expect(c.kill).toHaveBeenCalled();
  });

  it("reports an answer whose process is gone instead of starting a new one", async () => {
    const stream = await start(answerPrompt("cli-toolu_gone", true), "ask", "/w", "conv-gone");
    const parts = await readAll(stream);
    expect(parts.some((p) => p.type === "error" && /expired/.test(String(p.error?.message)))).toBe(true);
    expect(spawned.length).toBe(0);
  });

  it("kills the process when the request is aborted", async () => {
    const ac = new AbortController();
    const stream = await start(prompt(), "ask", "/w", "conv-abort", [], ac.signal);
    const parts = readAll(stream);
    await until(() => spawned.length === 1);
    ac.abort();
    expect(spawned[0].kill).toHaveBeenCalled();
    await parts;
  });
});

describe("watchdog while a card waits", () => {
  it("does not kill a parked run, and restarts the 120 s check once answered", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    const first = await start(prompt(), "ask", "/w", "conv-watch");
    const parts = readAll(first);
    await until(() => spawned.length === 1);
    const c = spawned[0];
    c.say(toolUse("toolu_watch", "Edit"));
    c.say(askRequest("req_watch", "toolu_watch"));
    await parts;
    vi.advanceTimersByTime(10 * 60_000);
    expect(c.kill).not.toHaveBeenCalled();

    const second = await start(answerPrompt("cli-toolu_watch", true), "ask", "/w", "conv-watch");
    const secondParts = readAll(second);
    vi.advanceTimersByTime(130_000);
    expect(c.kill).toHaveBeenCalled();
    await secondParts;
  });
});
