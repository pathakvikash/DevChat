import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { PassThrough, Writable } from "stream";
import { spawn } from "child_process";
import { streamText, convertToModelMessages, readUIMessageStream, type UIMessage } from "ai";
import { CLI_PROVIDERS, controlResponse, createCliModel } from "@/lib/cliProviders";

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
}

const realSetTimeout = globalThis.setTimeout;
const pause = () => new Promise<void>((r) => realSetTimeout(r, 2));
async function until(cond: () => boolean) {
  for (let i = 0; i < 2000 && !cond(); i++) await pause();
  expect(cond()).toBe(true);
}

let spawned: FakeChild[] = [];
beforeEach(() => {
  spawned = [];
  vi.mocked(spawn).mockImplementation(() => { const c = new FakeChild(); spawned.push(c); return c as any; });
});

const model = () => createCliModel(CLI_PROVIDERS.find((d) => d.id === "claude-code")!, "default");
const providerOptions = { "claude-code": { cwd: "/w", access: "ask", conversationId: "sdk-chat", allowedTools: [] } };

describe("Ask bridge through the AI SDK approval flow", () => {
  it("shows the card as an approval request, then resumes the parked process when answered", async () => {
    const first = streamText({ model: model(), messages: [{ role: "user", content: "Edit it" }], providerOptions } as any);
    const firstUi = readUIMessageStream({ stream: first.toUIMessageStream() as any });
    await until(() => spawned.length === 1);
    const c = spawned[0];
    c.say({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_sdk", name: "Edit", input: { file_path: "/w/a.txt" } }] } });
    c.say({ type: "control_request", request_id: "req_sdk", request: { subtype: "can_use_tool", tool_name: "Edit", input: { file_path: "/w/a.txt" }, tool_use_id: "toolu_sdk" } });
    let last: UIMessage | undefined;
    for await (const m of firstUi) last = m;
    const asked = last!.parts.find((p: any) => p.type === "dynamic-tool") as any;
    expect(asked.state).toBe("approval-requested");
    expect(asked.approval.id).toBe("cli-toolu_sdk");
    expect(asked.toolName).toBe("Edit");
    expect(c.kill).not.toHaveBeenCalled();

    // The browser marks the card answered; the SDK sends the reply back with the answer in place.
    const answered: UIMessage = { ...last!, parts: last!.parts.map((p: any) => (p.approval?.id === "cli-toolu_sdk" ? { ...p, state: "approval-responded", approval: { id: "cli-toolu_sdk", approved: true } } : p)) } as UIMessage;
    const modelMessages = await convertToModelMessages([{ role: "user", parts: [{ type: "text", text: "Edit it" }] } as any, answered]);
    const second = streamText({ model: model(), messages: modelMessages, providerOptions } as any);
    const secondDone = second.text;
    await until(() => c.written.length >= 2);
    expect(c.written[1]).toBe(controlResponse("req_sdk", { behavior: "allow" }));
    c.say({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Edited." }] } });
    c.say({ type: "result", subtype: "success", is_error: false, result: "Edited.", usage: { input_tokens: 1, output_tokens: 1 } });
    c.exit(0);
    expect(await secondDone).toBe("Edited.");
    expect(spawned.length).toBe(1);
  });
});
