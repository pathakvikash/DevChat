import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  claudeParser,
  opencodeParser,
  codexParser,
  flattenPrompt,
  cliProviderForModel,
  childEnv,
  CLI_PROVIDERS,
} from "@/lib/cliProviders";

// Real lines captured from `claude -p --output-format stream-json --include-partial-messages`
// and `opencode run --format json` on 2026-09-03.
const CLAUDE_LINES = [
  `{"type":"system","subtype":"init","cwd":"/tmp","session_id":"s","tools":[],"model":"claude-haiku-4-5-20251001"}`,
  `{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":""}}}`,
  `{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":""}],"usage":{"input_tokens":9}}}`,
  `{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Ready to "}}}`,
  `{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"help you."}}}`,
  `{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Ready to help you."}]}}`,
  `{"type":"result","subtype":"success","is_error":false,"result":"Ready to help you.","usage":{"input_tokens":471,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":100,"output_tokens_details":{"thinking_tokens":80}}}`,
];

describe("claudeParser", () => {
  it("streams text deltas once and reads usage from the result", () => {
    const parse = claudeParser();
    const events = CLAUDE_LINES.flatMap(parse);
    const text = events.filter((e) => e.type === "text").map((e) => (e as any).text).join("");
    expect(text).toBe("Ready to help you."); // assistant echo not double-counted
    const usage = events.find((e) => e.type === "usage") as any;
    expect(usage.usage).toMatchObject({ input: 471, output: 100, reasoning: 80 });
    expect(events.some((e) => e.type === "error")).toBe(false);
    // Thinking content is redacted by the CLI; we surface the count.
    expect((events.find((e) => e.type === "reasoning") as any).text).toMatch(/about 80 tokens/);
  });

  it("announces thinking as soon as a thinking block starts", () => {
    const parse = claudeParser();
    expect(parse(`{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}}`)).toEqual([
      { type: "reasoning", text: "Thinking…" },
    ]);
    expect(parse(`{"type":"stream_event","event":{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}}`)).toEqual([]);
  });

  it("flags upstream retries so the runner can stop a stuck tool", () => {
    const parse = claudeParser();
    expect(parse(`{"type":"system","subtype":"api_retry","attempt":1}`)).toEqual([{ type: "retry" }]);
    expect(parse(`{"type":"system","subtype":"status","status":"requesting"}`)).toEqual([]);
  });

  it("falls back to whole assistant messages when no deltas were streamed", () => {
    const parse = claudeParser();
    const events = [CLAUDE_LINES[0], CLAUDE_LINES[5], CLAUDE_LINES[6]].flatMap(parse);
    expect(events.filter((e) => e.type === "text")).toEqual([{ type: "text", text: "Ready to help you." }]);
  });

  it("surfaces errors reported in the result event", () => {
    const parse = claudeParser();
    const events = parse(`{"type":"result","subtype":"error_during_execution","is_error":true,"result":"Not logged in","usage":{}}`);
    expect(events.find((e) => e.type === "error")).toEqual({ type: "error", message: "Not logged in" });
  });

  it("ignores non-JSON noise", () => {
    expect(claudeParser()("some warning text")).toEqual([]);
  });
});

describe("opencodeParser", () => {
  it("emits reasoning, text parts and step usage", () => {
    const parse = opencodeParser();
    const events = [
      `{"type":"step_start","part":{"type":"step-start"}}`,
      `{"type":"reasoning","part":{"type":"reasoning","text":"17 * 23."}}`,
      `{"type":"text","part":{"type":"text","text":"Three words exactly."}}`,
      `{"type":"step_finish","part":{"type":"step-finish","reason":"stop","tokens":{"total":8300,"input":6494,"output":14,"reasoning":0,"cache":{"write":0,"read":1792}}}}`,
    ].flatMap(parse);
    expect(events).toEqual([
      { type: "reasoning", text: "17 * 23." },
      { type: "text", text: "Three words exactly." },
      { type: "usage", usage: { input: 6494, output: 14, reasoning: 0, cacheRead: 1792, cacheWrite: 0 } },
    ]);
  });
});

describe("opencodeParser tool steps", () => {
  const parse = opencodeParser();
  const use = (part: object) => JSON.stringify({ type: "tool_use", timestamp: 1, sessionID: "ses_a", part: { type: "tool", ...part } });

  it("shows a completed call as a call plus its result, unwrapping a task's answer", () => {
    const input = { description: "Reply with hi", prompt: "Say hi", subagent_type: "general" };
    const output = `<task id="ses_b" state="completed">\n<task_result>\nhi\n</task_result>\n</task>`;
    // The id carries the session: a sub-agent's calls restart their own ids.
    expect(parse(use({ tool: "task", callID: "call-3a6f", state: { status: "completed", input, output, metadata: {} } }))).toEqual([
      { type: "tool-call", id: "ses_a:call-3a6f", name: "task", input },
      { type: "tool-result", id: "ses_a:call-3a6f", name: "task", result: "hi", isError: false },
    ]);
    // Other tools pass their output through untouched.
    const [, read] = parse(use({ tool: "read", callID: "c2", state: { status: "completed", input: { filePath: "/a/b.txt" }, output: "1: x" } }));
    expect(read).toEqual({ type: "tool-result", id: "ses_a:c2", name: "read", result: "1: x", isError: false });
  });

  it("shows an errored call as a failed result with its error text", () => {
    expect(parse(use({ tool: "webfetch", callID: "c3", state: { status: "error", input: { url: "https://x.test" }, error: "Request failed with status code: 404" } }))).toEqual([
      { type: "tool-call", id: "ses_a:c3", name: "webfetch", input: { url: "https://x.test" } },
      { type: "tool-result", id: "ses_a:c3", name: "webfetch", result: "Request failed with status code: 404", isError: true },
    ]);
  });

  it("keeps a task answer that quotes the closing tag, and cuts a denial before its rule dump", () => {
    const answer = "Use </task_result> to close it.";
    const [, task] = parse(use({ tool: "task", callID: "c7", state: { status: "completed", input: {}, output: `<task id="s">\n<task_result>\n${answer}\n</task_result>\n</task>` } })) as any[];
    expect(task.result).toBe(answer);
    const denied = "The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules [{\"permission\":\"read\",\"pattern\":\"/Users/v/.local/*\"}]";
    const [, deny] = parse(use({ tool: "read", callID: "c8", state: { status: "error", input: {}, error: denied } })) as any[];
    expect(deny.result).toBe("The user has specified a rule which prevents you from using this specific tool call.");
  });

  it("marks a malformed call (OpenCode's invalid tool) as failed, and skips lines it cannot pair or finish", () => {
    const [, bad] = parse(use({ tool: "invalid", callID: "c4", state: { status: "completed", input: { tool: "read" }, output: "The arguments provided to the tool are invalid" } }));
    expect((bad as any).isError).toBe(true);
    expect(parse(use({ tool: "read", state: { status: "completed", input: {}, output: "x" } }))).toEqual([]);
    expect(parse(use({ callID: "c5", state: { status: "completed", input: {}, output: "x" } }))).toEqual([]);
    expect(parse(use({ tool: "read", callID: "c6", state: { status: "running", input: {} } }))).toEqual([]);
  });
});

describe("opencodeParser errors", () => {
  const parse = opencodeParser();

  it("turns the rejected-permission error (a stuck model) into a plain sentence", () => {
    const line = `{"type":"error","timestamp":1783000000000,"sessionID":"ses_abc","error":{"name":"UnknownError","data":{"message":"The user rejected permission to use this specific tool call."}}}`;
    const [ev] = parse(line) as any[];
    expect(ev.type).toBe("error");
    expect(ev.message).toBe("OpenCode stopped: the model got stuck on a tool call this chat doesn't allow. Try again, or pick a stronger model.");
  });

  it("turns a rule denial into the same sentence, without the rule dump", () => {
    const line = `{"type":"error","error":{"name":"UnknownError","data":{"message":"The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules [{\\"permission\\":\\"*\\",\\"action\\":\\"allow\\",\\"pattern\\":\\"*\\"}]"}}}`;
    const [ev] = parse(line) as any[];
    expect(ev.message).toBe("OpenCode stopped: the model got stuck on a tool call this chat doesn't allow. Try again, or pick a stronger model.");
  });

  it("shows OpenCode's own message from error.data.message", () => {
    const line = `{"type":"error","error":{"name":"ProviderAuthError","data":{"message":"Bad API key"}}}`;
    expect(parse(line)).toEqual([{ type: "error", message: "Bad API key" }]);
  });

  it("never leaks the raw JSON when there is no message", () => {
    const line = `{"type":"error","timestamp":1,"sessionID":"ses_abc","error":{"name":"UnknownError","data":{}}}`;
    const [ev] = parse(line) as any[];
    expect(ev.message).toBe("OpenCode stopped with an error.");
    expect(ev.message).not.toContain("{");
  });
});

describe("codexParser", () => {
  it("emits agent messages, turn usage and errors", () => {
    const parse = codexParser();
    const events = [
      `{"type":"thread.started","thread_id":"t"}`,
      `{"type":"item.completed","item":{"id":"r","type":"reasoning","text":"Thinking about it."}}`,
      `{"type":"item.completed","item":{"id":"i","type":"agent_message","text":"Hello there."}}`,
      `{"type":"turn.completed","usage":{"input_tokens":12,"cached_input_tokens":4,"output_tokens":3}}`,
      `{"type":"error","message":"boom"}`,
    ].flatMap(parse);
    expect(events).toEqual([
      { type: "reasoning", text: "Thinking about it." },
      { type: "text", text: "Hello there." },
      { type: "usage", usage: { input: 12, cacheRead: 4, output: 3 } },
      { type: "error", message: "boom" },
    ]);
  });

  it("never leaks the raw JSON when a failure has no message", () => {
    const [ev] = codexParser()(`{"type":"turn.failed","error":{"code":"x"}}`) as any[];
    expect(ev.message).toBe("Codex stopped with an error.");
  });
});

describe("flattenPrompt", () => {
  it("passes a single user turn through and keeps system separate", () => {
    const r = flattenPrompt([
      { role: "system", content: "Be brief." },
      { role: "user", content: [{ type: "text", text: "Hi" }] },
    ]);
    expect(r).toEqual({ system: "Be brief.", user: "Hi", warnings: [] });
  });

  it("leaves out calls the CLI ran itself, so the model is not shown them as a fence to repeat", () => {
    const r = flattenPrompt([
      { role: "user", content: [{ type: "text", text: "Q" }] },
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "t1", toolName: "Read", input: { file_path: "a" }, providerExecuted: true },
          { type: "tool-call", toolCallId: "t2", toolName: "createTodo", input: { title: "x" } },
          { type: "text", text: "Done." },
        ],
      },
      { role: "user", content: [{ type: "text", text: "Q2" }] },
    ] as any);
    expect(r.user).not.toContain("Read");
    expect(r.user).toContain('"name":"createTodo"');
  });

  it("flattens multi-turn history into a transcript and warns on non-text parts", () => {
    const r = flattenPrompt([
      { role: "user", content: [{ type: "text", text: "Q1" }, { type: "file", data: "AAAA", mediaType: "image/png" } as any] },
      { role: "assistant", content: [{ type: "text", text: "A1" }] },
      { role: "user", content: [{ type: "text", text: "Q2" }] },
    ]);
    expect(r.user).toContain("Human: Q1\n\nAssistant: A1\n\nHuman: Q2");
    expect(r.user.endsWith("Assistant:")).toBe(true);
    expect(r.warnings).toEqual([{ type: "unsupported", feature: "file parts", details: "CLI providers accept text only" }]);
  });
});

describe("CLI provider registry", () => {
  it("maps model ids by prefix and builds safe invocations", () => {
    expect(cliProviderForModel("claude-code/sonnet")?.id).toBe("claude-code");
    expect(cliProviderForModel("opencode/opencode/big-pickle")?.id).toBe("opencode");
    expect(cliProviderForModel("openai/gpt-4o")).toBeUndefined();

    const claude = CLI_PROVIDERS.find((d) => d.id === "claude-code")!;
    const spec = claude.invoke({ model: "sonnet", system: "S", user: "U", effort: "high" });
    expect(spec.args).toEqual(expect.arrayContaining(["-p", "--tools", "", "--setting-sources", "", "--system-prompt", "S", "--model", "sonnet", "--effort", "high"]));
    expect(spec.stdin).toBe("U");
    const plain = claude.invoke({ model: "default", system: "", user: "U" }).args;
    expect(plain).not.toContain("--model");
    expect(plain).not.toContain("--effort");

    const codex = CLI_PROVIDERS.find((d) => d.id === "codex")!;
    expect(codex.invoke({ model: "default", system: "", user: "U", effort: "max" }).args).toContain('model_reasoning_effort="high"');

    const oc = CLI_PROVIDERS.find((d) => d.id === "opencode")!;
    const ocSpec = oc.invoke({ model: "opencode/big-pickle", system: "S", user: "U", effort: "high" });
    expect(ocSpec.args).toContain("--thinking");
    expect(ocSpec.args.slice(-5)).toEqual(["opencode/big-pickle", "--variant", "high", "--", "System instructions:\nS\n\nU"]);
    expect(JSON.parse(ocSpec.env!.OPENCODE_CONFIG_CONTENT).permission.bash).toBe("deny");
  });

  it("keeps DevChat's provider keys and nested-session markers out of the tool's environment", () => {
    const saved = { ...process.env };
    process.env.ANTHROPIC_API_KEY = "sk-ant-devchat";
    process.env.OPENAI_API_KEY = "sk-devchat";
    process.env.GEMINI_API_KEY = "g";
    process.env.CLAUDECODE = "1";
    process.env.SOME_OTHER_VAR = "keep";
    // OpenCode lets this override the permission block the invocation sets in OPENCODE_CONFIG_CONTENT.
    process.env.OPENCODE_PERMISSION = '{"bash":"allow"}';
    try {
      const env = childEnv({ EXTRA: "x", OPENCODE_CONFIG_CONTENT: "{}" });
      expect(env.OPENCODE_PERMISSION).toBeUndefined();
      expect(env.OPENCODE_CONFIG_CONTENT).toBe("{}"); // merged after stripping, so it still wins
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.GEMINI_API_KEY).toBeUndefined();
      expect(env.CLAUDECODE).toBeUndefined();
      expect(env.SOME_OTHER_VAR).toBe("keep");
      expect(env.EXTRA).toBe("x");
      expect(env.PATH).toContain(".local/bin");
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });
});

import { ToolCallScanner, buildToolInstructions } from "@/lib/cliProviders";

describe("ToolCallScanner", () => {
  const names = new Set(["webSearch", "createTodo"]);
  const feed = (chunks: string[]) => {
    const s = new ToolCallScanner(names);
    let text = "";
    let call: unknown;
    for (const c of chunks) {
      const r = s.push(c);
      text += r.text;
      if (r.call) call = r.call;
    }
    const e = s.end();
    text += e.text;
    if (e.call) call = e.call;
    return { text, call };
  };

  it("passes plain text through unchanged, including stray backticks", () => {
    expect(feed(["Hello ", "wor", "ld. Use `code` here.\n```js\nx\n```"])).toEqual({
      text: "Hello world. Use `code` here.\n```js\nx\n```",
      call: undefined,
    });
  });

  it("extracts a tool call even when the fence is split across deltas", () => {
    const r = feed(["Let me look that up.\n``", "`tool_c", 'all\n{"name": "webSearch", "arguments": {"query": "bb agent"}}\n``', "`\nignored trailing text"]);
    expect(r.text).toBe("Let me look that up.");
    expect(r.call).toEqual({ name: "webSearch", args: { query: "bb agent" } });
  });

  it("accepts an unterminated block at the end of the stream", () => {
    const r = feed(['```tool_call\n{"name":"createTodo","arguments":{"title":"x"}}']);
    expect(r.call).toEqual({ name: "createTodo", args: { title: "x" } });
    expect(r.text).toBe("");
  });

  it("reports an invalid or unknown block instead of leaking the protocol", () => {
    expect(feed(["```tool_call\n{not json}\n```", " after"])).toEqual({
      text: "(tool call could not be parsed) after",
      call: undefined,
    });
    expect(feed(['```tool_call\n{"name":"rm -rf","arguments":{}}\n```'])).toEqual({
      text: "(tool call could not be parsed)",
      call: undefined,
    });
  });

  it("accepts the arguments on the fence line, with or without a closing fence", () => {
    const want = { name: "webSearch", args: { query: "bb agent" } };
    expect(feed(['```tool_call {"name":"webSearch","arguments":{"query":"bb agent"}}\n```'])).toEqual({ text: "", call: want });
    expect(feed(['```tool_call {"name":"webSearch","arguments":{"query":"bb agent"}}```'])).toEqual({ text: "", call: want });
    expect(feed(['```tool_call {"name":"webSearch","arguments":{"query":"bb agent"}}'])).toEqual({ text: "", call: want });
    // No newline before the closing fence, and none after it either.
    expect(feed(['Looking.\n```tool_call\n{"name":"webSearch","arguments":{"query":"bb agent"}}```'])).toEqual({
      text: "Looking.",
      call: want,
    });
  });

  it("takes a bare or homoglyphed marker as a call so it can never leak as text", () => {
    // The reported failure: sonnet opened with a fence-less, Cyrillic-т marker
    // and then repeated the call properly; the first copy leaked into the answer.
    const raw =
      'тool_call\n{"name":"webSearch","arguments":{"query":"GPT-6 Astra"}}\n\n' +
      '```tool_call\n{"name":"webSearch","arguments":{"query":"GPT-6 Astra"}}\n```';
    expect(feed([raw])).toEqual({ text: "", call: { name: "webSearch", args: { query: "GPT-6 Astra" } } });
    expect(feed(["Let me look.\n", 'tool_call\n{"name":"webSearch","arguments":{}}'])).toEqual({
      text: "Let me look.",
      call: { name: "webSearch", args: {} },
    });
    // Mid-sentence, "tool_call" is just a word: no fence, no line start, no call.
    expect(feed(["We call that a tool_call in the protocol."])).toEqual({
      text: "We call that a tool_call in the protocol.",
      call: undefined,
    });
  });

  it("takes Anthropic's own <function_calls> wrapper as a call", () => {
    // Models fall back to native tool-use syntax instead of the fence; unhandled, the
    // calls leak into the answer as text and no tool runs.
    const raw =
      '<function_calls>\n[{"name": "webSearch", "arguments": {"query": "GPT-6 Astra"}}]\n</function_calls>' +
      '<function_calls>\n[{"name": "webSearch", "arguments": {"query": "again"}}]\n</function_calls>\n\nI could not find it.';
    expect(feed([raw])).toEqual({ text: "", call: { name: "webSearch", args: { query: "GPT-6 Astra" } } });
    // Split across deltas, and with prose in front.
    expect(feed(["Let me look.<function", "_calls>[{\"name\":\"webSearch\",", '"arguments":{}}]</function_calls>'])).toEqual({
      text: "Let me look.",
      call: { name: "webSearch", args: {} },
    });
    // An unparseable one still must not leak the wrapper.
    expect(feed(["<function_calls>\n{not json}\n</function_calls>\nafter"])).toEqual({
      text: "(tool call could not be parsed)\nafter",
      call: undefined,
    });
  });

  it("passes a ```spec fence through intact alongside a tool call", () => {
    const spec =
      "```spec\n" +
      '{"op":"add","path":"/root","value":"main"}\n' +
      '{"op":"add","path":"/elements/main","value":{"type":"Table","props":{"dataArtifactId":"art_1"}}}\n' +
      "```";
    // Spec first, then the call: the spec must survive byte-for-byte.
    const r = feed([`Here it is:\n\n${spec}\n\n`, '```tool_call\n{"name":"webSearch","arguments":{"query":"x"}}\n```']);
    expect(r.text).toBe(`Here it is:\n\n${spec}`);
    expect(r.call).toEqual({ name: "webSearch", args: { query: "x" } });
    // A bare spec fence with no call is untouched, even split mid-fence.
    expect(feed([`Look:\n\n${spec.slice(0, 20)}`, `${spec.slice(20)}\n\nDone.`])).toEqual({
      text: `Look:\n\n${spec}\n\nDone.`,
      call: undefined,
    });
    // Call first, spec after: the spec is dropped on purpose — it predates the tool
    // result, and the next step emits its own patches for the same store.
    const r2 = feed([`\`\`\`tool_call\n{"name":"webSearch","arguments":{}}\n\`\`\`\n\n${spec}`]);
    expect(r2.call).toEqual({ name: "webSearch", args: {} });
    expect(r2.text).not.toContain("```spec");
  });

  it("keeps a fenced block that is not a call at all as text", () => {
    expect(feed(["```tool_call\nnot even JSON, just prose\n```"])).toEqual({
      text: "```tool_call\nnot even JSON, just prose\n```",
      call: undefined,
    });
  });

  it("never leaks a partial fence before knowing what it is", () => {
    const s = new ToolCallScanner(names);
    expect(s.push("answer ``").text).toBe("answer");
    expect(s.push("`too").text).toBe("");
    expect(s.push("l_call\n").text).toBe("");
    expect(s.push('{"name":"webSearch","arguments":{}}\n```').call).toEqual({ name: "webSearch", args: {} });
  });
});

describe("tool prompt plumbing", () => {
  it("describes tools with their schemas", () => {
    const text = buildToolInstructions([
      { type: "function", name: "webSearch", description: "Search the web", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
    ] as any);
    expect(text).toContain("```tool_call");
    expect(text).toContain("- webSearch: Search the web");
    expect(text).toContain('"query"');
  });

  it("renders tool calls and results into the transcript", () => {
    const r = flattenPrompt([
      { role: "user", content: [{ type: "text", text: "Search bb" }] },
      { role: "assistant", content: [{ type: "text", text: "Looking." }, { type: "tool-call", toolCallId: "c1", toolName: "webSearch", input: { query: "bb" } }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "webSearch", output: { type: "json", value: { hits: 3 } } }] },
    ] as any);
    expect(r.user).toContain('Assistant: Looking.\n```tool_call\n{"name":"webSearch","arguments":{"query":"bb"}}\n```');
    expect(r.user).toContain('Tool result: (webSearch) {"hits":3}');
    expect(r.user).toMatch(/use them to answer in prose now/);
    expect(r.user).toMatch(/do not repeat a tool call you already made with the same arguments/);
    expect(r.user.endsWith("Assistant:")).toBe(true);
  });
});

// `opencode run` has no UI to answer an "ask", so nothing may be left to ask (an ask is rejected and ends the run):
// external_directory and .env reads are denied (OpenCode's default for them is ask). doom_loop is checked outside
// the tool, where a deny ends the run too, so it is allowed and the step limit stops a model that never recovers.
const NEVER_ASK = {
  doom_loop: "allow",
  external_directory: "deny",
  read: { "*": "allow", "*.env": "deny", "*.env.*": "deny", "*.env.example": "allow" },
};

describe("working folder and access", () => {
  const claude = CLI_PROVIDERS.find((d) => d.id === "claude-code")!;
  const base = { model: "sonnet", system: "", user: "U" };

  it("keeps Claude Code sandboxed without a folder", () => {
    const a = claude.invoke(base).args;
    expect(a.slice(a.indexOf("--tools"), a.indexOf("--tools") + 2)).toEqual(["--tools", ""]);
    expect(a).not.toContain("--permission-mode");
    expect(claude.invoke(base).cwd).toBeUndefined();
    // No folder: none of the user's own MCP servers start either.
    expect(a).toContain("--strict-mcp-config");
    expect(claude.invoke({ ...base, cwd: "/repo", access: "chat" }).args).not.toContain("--strict-mcp-config");
  });

  it("marks Codex as needing a folder: its read-only sandbox still reads any file", () => {
    expect(CLI_PROVIDERS.find((d) => d.id === "codex")!.needsFolder).toBe(true);
    expect(CLI_PROVIDERS.find((d) => d.id === "claude-code")!.needsFolder).toBeUndefined();
    expect(CLI_PROVIDERS.find((d) => d.id === "opencode")!.needsFolder).toBeUndefined();
  });

  it("gives read-only tools in chat mode and edits in agent mode", () => {
    const chat = claude.invoke({ ...base, cwd: "/repo", access: "chat" });
    expect(chat.args).toEqual(expect.arrayContaining(["--tools", "Read", "Glob", "Grep", "WebSearch", "WebFetch"]));
    expect(chat.args).not.toContain("--permission-mode");
    expect(chat.cwd).toBe("/repo");

    const agent = claude.invoke({ ...base, cwd: "/repo", access: "agent" });
    expect(agent.args).toEqual(expect.arrayContaining(["--tools", "default", "--permission-mode", "acceptEdits"]));
    expect(agent.args).not.toContain("bypassPermissions");
  });

  it("plan is the read-only tool set plus Claude Code's plan permission mode", () => {
    const plan = claude.invoke({ ...base, cwd: "/repo", access: "plan" });
    expect(plan.args).toEqual(expect.arrayContaining(["--tools", "Read", "Glob", "Grep", "WebSearch", "WebFetch"]));
    expect(plan.args).toEqual(expect.arrayContaining(["--permission-mode", "plan"]));
    expect(plan.args).not.toContain("acceptEdits");
  });

  it("keeps OpenCode and Codex read-only in plan access", () => {
    const oc = CLI_PROVIDERS.find((d) => d.id === "opencode")!;
    expect(JSON.parse(oc.invoke({ ...base, model: "default", cwd: "/repo", access: "plan" }).env!.OPENCODE_CONFIG_CONTENT).permission.edit).toBe("deny");
    const codex = CLI_PROVIDERS.find((d) => d.id === "codex")!;
    expect(codex.invoke({ ...base, model: "default", cwd: "/repo", access: "plan" }).args).toEqual(expect.arrayContaining(["--sandbox", "read-only"]));
  });

  it("maps the same policy onto OpenCode and Codex", () => {
    const oc = CLI_PROVIDERS.find((d) => d.id === "opencode")!;
    const perm = (inv: ReturnType<typeof oc.invoke>) => JSON.parse(inv.env!.OPENCODE_CONFIG_CONTENT).permission;
    expect(perm(oc.invoke({ ...base, model: "default" }))).toEqual({ ...NEVER_ASK, bash: "deny", edit: "deny", webfetch: "deny", websearch: "deny" });
    expect(perm(oc.invoke({ ...base, model: "default", cwd: "/repo", access: "chat" }))).toEqual({ ...NEVER_ASK, bash: "deny", edit: "deny", webfetch: "allow", websearch: "allow" });
    expect(perm(oc.invoke({ ...base, model: "default", cwd: "/repo", access: "agent" }))).toEqual({ ...NEVER_ASK, bash: "deny", edit: "allow", webfetch: "allow", websearch: "allow" });
    expect(oc.invoke({ ...base, model: "default", cwd: "/repo" }).args).toEqual(expect.arrayContaining(["--dir", "/repo"]));
    // A model that repeats a denied call forever is cut off.
    expect(JSON.parse(oc.invoke({ ...base, model: "default" }).env!.OPENCODE_CONFIG_CONTENT).agent.build.steps).toBe(50);
    // Its sub-agents are silent until they finish, so it gets a long watchdog; the others keep the default.
    expect(oc.inactivityMs).toBe(15 * 60_000);
    expect(claude.inactivityMs).toBeUndefined();

    const codex = CLI_PROVIDERS.find((d) => d.id === "codex")!;
    expect(codex.invoke({ ...base, model: "default", cwd: "/repo", access: "agent" }).args).toEqual(expect.arrayContaining(["--sandbox", "workspace-write", "-C", "/repo"]));
    expect(codex.invoke({ ...base, model: "default", cwd: "/repo", access: "chat" }).args).toEqual(expect.arrayContaining(["--sandbox", "read-only"]));
  });

  it("surfaces the tools Claude Code ran, with names on the results", () => {
    // Real lines from a read-only run on 2026-09-04.
    const parse = claudeParser();
    const events = [
      `{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_01","name":"Read","input":{"file_path":"notes.txt"}}]}}`,
      `{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_01","content":"1\\tThe secret word is PINEAPPLE.\\n"}]}}`,
      `{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_02","is_error":true,"content":"denied"}]}}`,
      `{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"PINEAPPLE."}}}`,
    ].flatMap(parse);
    expect(events).toEqual([
      { type: "tool-call", id: "toolu_01", name: "Read", input: { file_path: "notes.txt" } },
      { type: "tool-result", id: "toolu_01", name: "Read", result: "1\tThe secret word is PINEAPPLE.\n", isError: false },
      { type: "tool-result", id: "toolu_02", name: "tool", result: "denied", isError: true },
      { type: "text", text: "PINEAPPLE." },
    ]);
  });

  describe("the app's own .env values", () => {
    const dirs: string[] = [];
    const home = process.cwd();
    afterEach(() => {
      process.chdir(home);
      vi.unstubAllEnvs();
      for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    });

    /** childEnv run with these .env files in the app's folder (the cwd) and `vars` set in the process. */
    function envWith(files: Record<string, string>, vars: Record<string, string>, mode = "test", extra?: Record<string, string>) {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), "appenv-")));
      dirs.push(dir);
      for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
      process.chdir(dir);
      vi.stubEnv("NODE_ENV", mode);
      for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
      return childEnv(extra);
    }

    it("stay out of the tool, whichever .env file Next reads them from", () => {
      // The names are made up for this test; the values stand for secrets.
      const env = envWith(
        { ".env": "APPENV_A=1\nAPPENV_B=2", ".env.test": "APPENV_C=3", ".env.test.local": "APPENV_D=4" },
        { APPENV_A: "a", APPENV_B: "b", APPENV_C: "c", APPENV_D: "d", APPENV_FROM_SHELL: "kept" },
      );
      for (const k of ["APPENV_A", "APPENV_B", "APPENV_C", "APPENV_D"]) expect(env[k]).toBeUndefined();
      // Only what a .env file defines is the app's own.
      expect(env.APPENV_FROM_SHELL).toBe("kept");
    });

    it("still stay out when Next has already loaded them (__NEXT_PROCESSED_ENV), where @next/env would report nothing", () => {
      const env = envWith({ ".env": "APPENV_E=1" }, { APPENV_E: "e", __NEXT_PROCESSED_ENV: "true" });
      expect(env.APPENV_E).toBeUndefined();
    });

    it("follows Next's file list: .env.local is skipped in test, read in production, and the mode's own files are not mixed up", () => {
      const files = { ".env.local": "APPENV_L=1", ".env.production": "APPENV_P=1", ".env.development": "APPENV_V=1" };
      const vars = { APPENV_L: "l", APPENV_P: "p", APPENV_V: "v" };
      const test = envWith(files, vars, "test");
      expect([test.APPENV_L, test.APPENV_P, test.APPENV_V]).toEqual(["l", "p", "v"]);
      const prod = envWith(files, vars, "production");
      expect([prod.APPENV_L, prod.APPENV_P, prod.APPENV_V]).toEqual([undefined, undefined, "v"]);
      const dev = envWith(files, vars, "development");
      expect([dev.APPENV_L, dev.APPENV_P, dev.APPENV_V]).toEqual([undefined, "p", undefined]);
    });

    it("keep what the tool needs to run and reach the network, even when a .env file sets it", () => {
      const keep = ["HOME", "HTTPS_PROXY", "https_proxy", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "CLAUDE_CONFIG_DIR", "CODEX_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME"];
      const env = envWith({ ".env": keep.map((k) => `${k}=x`).join("\n") }, Object.fromEntries(keep.map((k) => [k, `v-${k}`])));
      for (const k of keep) expect(env[k]).toBe(`v-${k}`);
      expect(env.PATH).toContain(".local/bin");
    });

    it("do not break a run when a .env file is missing or will not parse", () => {
      const env = envWith({ ".env": "\0\0 not a dotenv file" }, {});
      expect(env.PATH).toContain(".local/bin");
    });

    it("never strip what the invocation itself passes", () => {
      expect(envWith({ ".env": "APPENV_F=1" }, {}, "test", { APPENV_F: "from invoke" }).APPENV_F).toBe("from invoke");
    });
  });

  it("points PWD at the folder the child is spawned in, not DevChat's own", () => {
    const saved = process.env.PWD;
    process.env.PWD = "/devchat/server/folder";
    try {
      expect(childEnv({}, "/tmp/devchat-cli").PWD).toBe("/tmp/devchat-cli");
      expect(childEnv(undefined, "/repo").PWD).toBe("/repo");
      expect(childEnv().PWD).toBe("/devchat/server/folder"); // no cwd given: untouched
    } finally {
      if (saved === undefined) delete process.env.PWD;
      else process.env.PWD = saved;
    }
  });

  it("strips nested-session markers the way the /claude runner does", () => {
    const saved = { ...process.env };
    process.env.CLAUDE_CODE_SSE_PORT = "1";
    process.env.CLAUDE_PID = "2";
    process.env.ANTHROPIC_API_URL = "x";
    try {
      const env = childEnv();
      expect(env.CLAUDE_CODE_SSE_PORT).toBeUndefined();
      expect(env.CLAUDE_PID).toBeUndefined();
      expect(env.ANTHROPIC_API_URL).toBeUndefined();
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });
});
