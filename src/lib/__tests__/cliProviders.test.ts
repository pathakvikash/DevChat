import { describe, it, expect } from "vitest";
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
});

describe("flattenPrompt", () => {
  it("passes a single user turn through and keeps system separate", () => {
    const r = flattenPrompt([
      { role: "system", content: "Be brief." },
      { role: "user", content: [{ type: "text", text: "Hi" }] },
    ]);
    expect(r).toEqual({ system: "Be brief.", user: "Hi", warnings: [] });
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
    try {
      const env = childEnv({ EXTRA: "x" });
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

  it("shows an invalid or unknown block as ordinary text", () => {
    expect(feed(["```tool_call\n{not json}\n```", " after"]).text).toBe("```tool_call\n{not json}\n``` after");
    expect(feed(['```tool_call\n{"name":"rm -rf","arguments":{}}\n```']).call).toBeUndefined();
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
    expect(r.user).toMatch(/use them to answer/);
    expect(r.user.endsWith("Assistant:")).toBe(true);
  });
});
