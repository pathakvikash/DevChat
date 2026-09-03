import { spawn, execFile, type ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import { access, constants, mkdir } from "fs/promises";
import { homedir, tmpdir } from "os";
import { delimiter, join } from "path";
import { createInterface } from "readline";
import type { LanguageModel } from "ai";
import { PROVIDERS, ENV_ALIASES } from "./providers";

// `ai` only exports the `LanguageModel` union publicly; carve the v3 provider
// interface out of it rather than depending on `@ai-sdk/provider` directly.
type LanguageModelV3 = Extract<Exclude<LanguageModel, string>, { specificationVersion: "v3" }>;
type LanguageModelV3CallOptions = Parameters<LanguageModelV3["doStream"]>[0];

/**
 * Coding-agent CLIs as chat providers, the way bb does it: instead of reading
 * their credentials (subscription logins are licensed to the tool that issued
 * them), DevChat launches the tool itself in headless mode and streams its
 * output. Each tool uses whatever login it already has.
 *
 * Only meaningful when the DevChat server runs on the user's own machine —
 * callers gate on detectionAvailable(). Tools run with their own file/shell
 * tools disabled, in a scratch directory, so a chat here can't touch the
 * user's files. DevChat's own tools ARE available to these models, through
 * the text protocol in the "Tool calling over plain text" section below.
 */

type StreamPart = Awaited<ReturnType<LanguageModelV3["doStream"]>>["stream"] extends ReadableStream<infer P>
  ? P
  : never;
type Usage = Extract<StreamPart, { type: "finish" }>["usage"];
type Warning = Extract<StreamPart, { type: "stream-start" }>["warnings"][number];
type Prompt = LanguageModelV3CallOptions["prompt"];
type GenerateResult = Awaited<ReturnType<LanguageModelV3["doGenerate"]>>;

export interface CliModel {
  id: string;
  name: string;
}

export interface CliUsage {
  input?: number;
  cacheRead?: number;
  cacheWrite?: number;
  output?: number;
  reasoning?: number;
}

export type CliEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "usage"; usage: CliUsage }
  | { type: "error"; message: string }
  /** The tool is retrying its upstream API call; several in a row with no reply means it's stuck. */
  | { type: "retry" };

export interface CliInvocation {
  model: string;
  system: string;
  user: string;
  /** low | medium | high | max, from the conversation's reasoning-effort setting. */
  effort?: string;
}

export interface CliProviderDef {
  /** Model-id prefix, e.g. `claude-code/sonnet`. */
  id: string;
  label: string;
  bin: string;
  contextWindow: number;
  /** Fixed list, or "discover" to ask the tool (currently `opencode models`). */
  models: CliModel[] | "discover";
  invoke(p: CliInvocation): { args: string[]; stdin?: string; env?: Record<string, string> };
  /** Stateful line parser factory: one instance per run. */
  parser(): (line: string) => CliEvent[];
}

function json(line: string): Record<string, any> | null {
  const t = line.trim();
  if (!t.startsWith("{")) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

/** `claude -p --output-format stream-json --include-partial-messages` */
export function claudeParser(): (line: string) => CliEvent[] {
  let streamed = false;
  return (line) => {
    const e = json(line);
    if (!e) return [];
    if (e.type === "stream_event") {
      const d = e.event?.delta;
      if (e.event?.type === "content_block_delta" && d?.type === "text_delta" && typeof d.text === "string") {
        streamed = true;
        return [{ type: "text", text: d.text }];
      }
      return [];
    }
    if (e.type === "system") return e.subtype === "api_retry" ? [{ type: "retry" }] : [];
    // Older versions without partial messages: whole assistant messages.
    if (e.type === "assistant" && !streamed) {
      const text = (e.message?.content ?? [])
        .filter((p: any) => p?.type === "text" && typeof p.text === "string")
        .map((p: any) => p.text)
        .join("");
      return text ? [{ type: "text", text }] : [];
    }
    if (e.type === "result") {
      const u = e.usage ?? {};
      const thinking = u.output_tokens_details?.thinking_tokens;
      const out: CliEvent[] = [];
      // Claude Code redacts thinking content in its stream; the token count is
      // all it exposes, so that is what we can show.
      if (typeof thinking === "number" && thinking > 0) {
        out.push({ type: "reasoning", text: `Claude Code thought for about ${thinking} tokens. (Claude Code does not expose the content of its thinking.)` });
      }
      out.push({
        type: "usage",
        usage: {
          input: u.input_tokens,
          cacheWrite: u.cache_creation_input_tokens,
          cacheRead: u.cache_read_input_tokens,
          output: u.output_tokens,
          reasoning: thinking,
        },
      });
      if (e.is_error) out.push({ type: "error", message: String(e.result || e.subtype || "Claude Code returned an error") });
      return out;
    }
    return [];
  };
}

/** `opencode run --format json --thinking` */
export function opencodeParser(): (line: string) => CliEvent[] {
  return (line) => {
    const e = json(line);
    if (!e) return [];
    if (e.type === "text" && typeof e.part?.text === "string") return [{ type: "text", text: e.part.text }];
    if (e.type === "reasoning" && typeof e.part?.text === "string") return [{ type: "reasoning", text: e.part.text }];
    if (e.type === "step_finish") {
      const t = e.part?.tokens ?? {};
      return [
        {
          type: "usage",
          usage: { input: t.input, output: t.output, reasoning: t.reasoning, cacheRead: t.cache?.read, cacheWrite: t.cache?.write },
        },
      ];
    }
    if (e.type === "error") return [{ type: "error", message: e.error?.message ?? e.message ?? JSON.stringify(e) }];
    return [];
  };
}

/** `codex exec --json` (JSONL items). Written from the documented format; not exercised here. */
export function codexParser(): (line: string) => CliEvent[] {
  return (line) => {
    const e = json(line);
    if (!e) return [];
    if (e.type === "item.completed" && typeof e.item?.text === "string") {
      if (e.item.type === "agent_message") return [{ type: "text", text: e.item.text }];
      if (e.item.type === "reasoning") return [{ type: "reasoning", text: e.item.text }];
      return [];
    }
    if (e.type === "turn.completed") {
      const u = e.usage ?? {};
      return [{ type: "usage", usage: { input: u.input_tokens, cacheRead: u.cached_input_tokens, output: u.output_tokens } }];
    }
    if (e.type === "error" || e.type === "turn.failed") return [{ type: "error", message: e.message ?? e.error?.message ?? JSON.stringify(e) }];
    return [];
  };
}

const withSystem = (system: string, user: string) => (system ? `System instructions:\n${system}\n\n${user}` : user);

export const CLI_PROVIDERS: readonly CliProviderDef[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    bin: "claude",
    contextWindow: 200_000,
    models: [
      { id: "default", name: "Default (your Claude Code setting)" },
      { id: "sonnet", name: "Sonnet" },
      { id: "opus", name: "Opus" },
      { id: "haiku", name: "Haiku" },
    ],
    // --setting-sources "" skips the user's hooks and settings; --tools "" keeps
    // Claude Code from touching this machine; --system-prompt replaces its
    // coding-agent prompt with DevChat's (drops ~12k tokens of default prompt).
    invoke: ({ model, system, user, effort }) => ({
      args: [
        "-p",
        "--output-format", "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--no-session-persistence",
        "--setting-sources", "",
        "--tools", "",
        ...(system ? ["--system-prompt", system] : []),
        ...(model !== "default" ? ["--model", model] : []),
        ...(effort ? ["--effort", effort] : []),
      ],
      stdin: user,
    }),
    parser: claudeParser,
  },
  {
    id: "codex",
    label: "Codex",
    bin: "codex",
    contextWindow: 200_000,
    models: [{ id: "default", name: "Default (your Codex setting)" }],
    invoke: ({ model, system, user, effort }) => ({
      args: [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--sandbox", "read-only",
        ...(model !== "default" ? ["--model", model] : []),
        ...(effort ? ["-c", `model_reasoning_effort="${effort === "max" ? "high" : effort}"`] : []),
        "-",
      ],
      stdin: withSystem(system, user),
    }),
    parser: codexParser,
  },
  {
    id: "opencode",
    label: "OpenCode",
    bin: "opencode",
    contextWindow: 128_000,
    models: "discover",
    invoke: ({ model, system, user, effort }) => ({
      args: [
        "run",
        "--format", "json",
        "--pure",
        "--thinking",
        ...(model !== "default" ? ["--model", model] : []),
        ...(effort ? ["--variant", effort] : []),
        "--",
        withSystem(system, user),
      ],
      env: {
        OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: { edit: "deny", bash: "deny", webfetch: "deny" } }),
      },
    }),
    parser: opencodeParser,
  },
];

export function cliProviderForModel(modelId: string): CliProviderDef | undefined {
  const prefix = modelId.slice(0, modelId.indexOf("/"));
  return CLI_PROVIDERS.find((d) => d.id === prefix);
}

// ─── Locating and running the binaries ──────────────────────────────────────

// Dev servers started from an IDE often have a minimal PATH; these are where
// the CLIs' installers put them.
const EXTRA_BIN_DIRS = [
  join(homedir(), ".local", "bin"),
  join(homedir(), ".opencode", "bin"),
  join(homedir(), ".npm-global", "bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
];

function searchPath(): string {
  return [...(process.env.PATH ?? "").split(delimiter), ...EXTRA_BIN_DIRS].filter(Boolean).join(delimiter);
}

// DevChat's own provider configuration (from .env) must not leak into the
// tool: Claude Code, for one, prefers ANTHROPIC_API_KEY over its subscription
// login and then retries a bad key forever. The tool must use its own login.
const STRIPPED_ENV = new Set([
  ...PROVIDERS.map((p) => p.envKey),
  ...PROVIDERS.flatMap((p) => (p.envBaseUrl ? [p.envBaseUrl] : [])),
  ...Object.keys(ENV_ALIASES),
  "ANTHROPIC_AUTH_TOKEN",
  // Claude Code refuses to start inside another Claude Code session.
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
]);

export function childEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra, PATH: searchPath() };
  for (const k of STRIPPED_ENV) delete env[k];
  return env;
}

const binCache = new Map<string, { at: number; found: boolean }>();
const BIN_TTL = 60_000;

async function hasBin(bin: string): Promise<boolean> {
  const hit = binCache.get(bin);
  if (hit && Date.now() - hit.at < BIN_TTL) return hit.found;
  let found = false;
  for (const dir of searchPath().split(delimiter)) {
    try {
      await access(join(dir, bin), constants.X_OK);
      found = true;
      break;
    } catch {
      // keep looking
    }
  }
  binCache.set(bin, { at: Date.now(), found });
  return found;
}

/** Ids of CLI providers whose binary is installed. */
export async function findCliBins(): Promise<Set<string>> {
  const out = new Set<string>();
  await Promise.all(CLI_PROVIDERS.map(async (d) => (await hasBin(d.bin)) && out.add(d.id)));
  return out;
}

const discoverCache = new Map<string, { at: number; models: CliModel[] }>();
const DISCOVER_TTL = 5 * 60_000;
const FALLBACK_MODELS: CliModel[] = [{ id: "default", name: "Default" }];

function discoverModels(def: CliProviderDef): Promise<CliModel[]> {
  const hit = discoverCache.get(def.id);
  if (hit && Date.now() - hit.at < DISCOVER_TTL) return Promise.resolve(hit.models);
  return new Promise((resolve) => {
    execFile(def.bin, ["models"], { env: childEnv(), timeout: 20_000, maxBuffer: 1 << 20 }, (err, stdout) => {
      if (err) {
        console.warn(`[cli] ${def.label} models: ${err.message}`);
        resolve(FALLBACK_MODELS);
        return;
      }
      const ids = String(stdout)
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.includes("/") && !/\s/.test(s));
      const models = ids.length ? ids.map((id) => ({ id, name: id })) : FALLBACK_MODELS;
      discoverCache.set(def.id, { at: Date.now(), models });
      resolve(models);
    });
  });
}

export interface CliCatalogEntry {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  model: LanguageModelV3;
}

export interface CliStatus {
  id: string;
  label: string;
  configured: boolean;
  modelCount: number;
  kind: "cli";
}

/** Every model reachable through an installed CLI, plus per-tool status. */
export async function listCliModels(): Promise<{ entries: CliCatalogEntry[]; status: CliStatus[] }> {
  const entries: CliCatalogEntry[] = [];
  const status = await Promise.all(
    CLI_PROVIDERS.map(async (def): Promise<CliStatus> => {
      if (!(await hasBin(def.bin))) return { id: def.id, label: def.label, configured: false, modelCount: 0, kind: "cli" };
      const models = def.models === "discover" ? await discoverModels(def) : def.models;
      for (const m of models) {
        entries.push({
          id: `${def.id}/${m.id}`,
          name: m.name,
          provider: def.label,
          contextWindow: def.contextWindow,
          model: createCliModel(def, m.id),
        });
      }
      return { id: def.id, label: def.label, configured: true, modelCount: models.length, kind: "cli" };
    }),
  );
  return { entries, status };
}

// ─── Prompt → CLI input ─────────────────────────────────────────────────────

/**
 * CLIs take one prompt string, so the chat history is flattened into a
 * transcript. System messages go separately (Claude Code has a flag; the
 * others get it prepended by `invoke`).
 */
const MAX_TOOL_RESULT_CHARS = 8_000;

function toolOutputText(output: { type: string; value?: unknown; reason?: string }): string {
  let text: string;
  switch (output.type) {
    case "text":
    case "error-text":
      text = String(output.value ?? "");
      break;
    case "content":
      text = (Array.isArray(output.value) ? output.value : [])
        .map((c: any) => (c?.type === "text" ? c.text : `[${c?.type ?? "media"}]`))
        .join("\n");
      break;
    case "execution-denied":
      text = `Execution denied${output.reason ? `: ${output.reason}` : ""}`;
      break;
    default:
      text = JSON.stringify(output.value ?? null);
  }
  if (output.type.startsWith("error")) text = `ERROR: ${text}`;
  return text.length > MAX_TOOL_RESULT_CHARS ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n[…truncated]` : text;
}

export function flattenPrompt(prompt: Prompt): { system: string; user: string; warnings: Warning[] } {
  const system: string[] = [];
  const turns: Array<{ role: "Human" | "Assistant" | "Tool result"; text: string }> = [];
  const unsupported = new Set<string>();
  let sawTools = false;

  for (const m of prompt) {
    if (m.role === "system") {
      system.push(m.content);
      continue;
    }
    if (m.role === "tool") {
      for (const p of m.content) {
        if (p.type !== "tool-result") continue;
        sawTools = true;
        turns.push({ role: "Tool result", text: `(${p.toolName}) ${toolOutputText(p.output)}` });
      }
      continue;
    }
    const text = m.content
      .map((p) => {
        if (p.type === "text") return p.text;
        if (p.type === "tool-call") {
          sawTools = true;
          return `\`\`\`tool_call\n${JSON.stringify({ name: p.toolName, arguments: p.input ?? {} })}\n\`\`\``;
        }
        if (p.type !== "reasoning" && p.type !== "tool-result") unsupported.add(`${p.type} parts`);
        return "";
      })
      .filter(Boolean)
      .join("\n");
    if (text) turns.push({ role: m.role === "user" ? "Human" : "Assistant", text });
  }

  const user =
    turns.length <= 1 && !sawTools
      ? (turns[0]?.text ?? "")
      : "Continue this conversation as the Assistant. Reply with only your next Assistant message; do not repeat the transcript." +
        (sawTools ? " Tool results below are the outcomes of tool calls you made; use them to answer." : "") +
        "\n\n" +
        turns.map((t) => `${t.role}: ${t.text}`).join("\n\n") +
        "\n\nAssistant:";

  return {
    system: system.join("\n\n"),
    user,
    warnings: [...unsupported].map((feature) => ({ type: "unsupported", feature, details: "CLI providers accept text only" })),
  };
}

// ─── Tool calling over plain text ────────────────────────────────────────────
//
// CLIs return text, and their own tools are switched off, so DevChat's tools
// are offered as a prompt protocol: the model ends its reply with one fenced
// ```tool_call block; the scanner below turns that into an AI SDK tool call,
// the SDK runs the tool, and the next turn's transcript carries the result.

const FENCE = "```tool_call";

type FunctionTool = Extract<NonNullable<LanguageModelV3CallOptions["tools"]>[number], { type: "function" }>;

export function buildToolInstructions(tools: FunctionTool[]): string {
  const list = tools
    .map((t) => `- ${t.name}: ${t.description ?? ""}\n  arguments schema: ${JSON.stringify(t.inputSchema)}`)
    .join("\n");
  return [
    "## Tools",
    "You can use the tools listed below. To call one, write any brief explanation first, then end your reply with exactly one fenced block in this form and nothing after it:",
    "```tool_call",
    '{"name": "<tool name>", "arguments": { ... }}',
    "```",
    "Call at most one tool per reply. The result arrives in the next turn as a \"Tool result\" entry; then continue, calling another tool or giving the final answer. If no tool is needed, answer normally without the block.",
    "",
    "Available tools:",
    list,
  ].join("\n");
}

export interface ParsedToolCall {
  name: string;
  args: unknown;
}

/** Length of the longest suffix of `s` that could be the start of FENCE. */
function partialFenceLen(s: string): number {
  for (let n = Math.min(FENCE.length - 1, s.length); n > 0; n--) {
    if (FENCE.startsWith(s.slice(-n))) return n;
  }
  return 0;
}

/**
 * Splits streamed text into displayable text and at most one tool call.
 * Holds back a possible partial fence at the tail so the marker never leaks
 * to the reader; anything after a completed call is dropped.
 */
export class ToolCallScanner {
  private buf = "";
  private inTool = false;
  private done = false;

  constructor(private readonly names: Set<string>) {}

  push(delta: string): { text: string; call?: ParsedToolCall } {
    if (this.done) return { text: "" };
    this.buf += delta;
    if (!this.inTool) {
      const i = this.buf.indexOf(FENCE);
      if (i < 0) {
        // Hold back a possible partial fence at the tail, and the whitespace
        // just before it, so neither leaks if a tool_call block follows.
        let keep = partialFenceLen(this.buf);
        const before = this.buf.slice(0, this.buf.length - keep);
        keep += before.length - before.trimEnd().length;
        const text = this.buf.slice(0, this.buf.length - keep);
        this.buf = this.buf.slice(this.buf.length - keep);
        return { text };
      }
      const text = this.buf.slice(0, i).replace(/\s+$/, "");
      this.buf = this.buf.slice(i);
      this.inTool = true;
      return { text, ...this.tryClose() };
    }
    return { text: "", ...this.tryClose() };
  }

  end(): { text: string; call?: ParsedToolCall } {
    if (this.done) return { text: "" };
    const buf = this.buf;
    this.buf = "";
    if (!this.inTool) return { text: buf };
    // Unterminated block: accept it if it parses, otherwise show it as text.
    const nl = buf.indexOf("\n");
    const call = nl >= 0 ? this.parse(buf.slice(nl + 1).replace(/```\s*$/, "")) : null;
    this.done = true;
    return call ? { text: "", call } : { text: buf };
  }

  private tryClose(): { text?: string; call?: ParsedToolCall } {
    const nl = this.buf.indexOf("\n");
    if (nl < 0) return {};
    const close = this.buf.indexOf("```", nl + 1);
    if (close < 0) return {};
    const call = this.parse(this.buf.slice(nl + 1, close));
    if (call) {
      this.done = true;
      this.buf = "";
      return { call };
    }
    // Not a valid call: pass the block through as ordinary text and carry on.
    const raw = this.buf.slice(0, close + 3);
    this.buf = this.buf.slice(close + 3);
    this.inTool = false;
    return { text: raw };
  }

  private parse(body: string): ParsedToolCall | null {
    try {
      const j = JSON.parse(body.trim());
      const name = j?.name ?? j?.tool;
      if (typeof name !== "string" || !this.names.has(name)) return null;
      return { name, args: j.arguments ?? j.input ?? j.args ?? {} };
    } catch {
      return null;
    }
  }
}

function toUsage(u: CliUsage): Usage {
  const has = (n?: number) => typeof n === "number";
  const anyInput = has(u.input) || has(u.cacheRead) || has(u.cacheWrite);
  return {
    inputTokens: {
      total: anyInput ? (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0) : undefined,
      noCache: u.input,
      cacheRead: u.cacheRead,
      cacheWrite: u.cacheWrite,
    },
    outputTokens: {
      total: u.output,
      text: has(u.output) ? (u.output as number) - (u.reasoning ?? 0) : undefined,
      reasoning: u.reasoning,
    },
  };
}

/** Kill the tool if it prints nothing for this long; a stuck CLI must not hang the chat. */
const INACTIVITY_MS = 120_000;
/** Upstream retries in a row with no reply before we give up on the tool. */
const MAX_RETRIES = 3;

function runCli(
  def: CliProviderDef,
  spec: ReturnType<CliProviderDef["invoke"]>,
  warnings: Warning[],
  signal?: AbortSignal,
  toolNames?: Set<string>,
): ReadableStream<StreamPart> {
  let child: ChildProcess | undefined;
  return new ReadableStream<StreamPart>({
    async start(controller) {
      controller.enqueue({ type: "stream-start", warnings });
      const cwd = join(tmpdir(), "devchat-cli");
      await mkdir(cwd, { recursive: true });

      child = spawn(def.bin, spec.args, { cwd, env: childEnv(spec.env), stdio: ["pipe", "pipe", "pipe"] });
      const proc = child;
      const parse = def.parser();
      const scanner = toolNames?.size ? new ToolCallScanner(toolNames) : null;
      const textId = "text-1";
      const reasoningId = "reasoning-1";
      let textOpen = false;
      let sawOutput = false;
      let toolCalled = false;
      let reasoningOpen = false;
      let exited = false;
      let linesDone = false;
      let finished = false;
      let exitCode: number | null = null;
      let errorMsg: string | undefined;
      let stderr = "";
      let retries = 0;
      let lastActivity = Date.now();
      const usage: CliUsage = {};

      const stop = (reason: string) => {
        if (!errorMsg) errorMsg = reason;
        proc.kill("SIGTERM");
      };
      const watchdog = setInterval(() => {
        if (Date.now() - lastActivity > INACTIVITY_MS) {
          stop(`${def.label} produced no output for ${INACTIVITY_MS / 1000}s and was stopped. Check that \`${def.bin}\` works in a terminal.`);
        }
      }, 5_000);

      const closeReasoning = () => {
        if (reasoningOpen) {
          controller.enqueue({ type: "reasoning-end", id: reasoningId });
          reasoningOpen = false;
        }
      };
      const emitText = (text: string) => {
        if (!text) return;
        closeReasoning();
        sawOutput = true;
        if (!textOpen) {
          controller.enqueue({ type: "text-start", id: textId });
          textOpen = true;
        }
        controller.enqueue({ type: "text-delta", id: textId, delta: text });
      };
      const emitScan = ({ text, call }: { text: string; call?: ParsedToolCall }) => {
        emitText(text);
        if (!call) return;
        if (textOpen) {
          controller.enqueue({ type: "text-end", id: textId });
          textOpen = false;
        }
        sawOutput = true;
        toolCalled = true;
        controller.enqueue({
          type: "tool-call",
          toolCallId: `call_${randomUUID().slice(0, 8)}`,
          toolName: call.name,
          input: JSON.stringify(call.args ?? {}),
        });
      };
      const finish = () => {
        if (finished || !exited || !linesDone) return;
        finished = true;
        clearInterval(watchdog);
        if (scanner) emitScan(scanner.end());
        closeReasoning();
        if (textOpen) controller.enqueue({ type: "text-end", id: textId });
        const failed = !!errorMsg || (exitCode !== 0 && !sawOutput);
        if (failed) {
          const tail = stderr.trim().slice(-600);
          controller.enqueue({
            type: "error",
            error: new Error(errorMsg || `${def.label} exited with code ${exitCode}${tail ? `: ${tail}` : ""}`),
          });
        }
        controller.enqueue({
          type: "finish",
          finishReason: { unified: failed ? "error" : toolCalled ? "tool-calls" : "stop", raw: undefined },
          usage: toUsage(usage),
        });
        controller.close();
      };

      const rl = createInterface({ input: proc.stdout! });
      rl.on("line", (line) => {
        lastActivity = Date.now();
        for (const ev of parse(line)) {
          if (ev.type === "text") {
            if (!ev.text) continue;
            if (scanner) emitScan(scanner.push(ev.text));
            else emitText(ev.text);
          } else if (ev.type === "reasoning") {
            // May arrive after the answer (Claude Code reports its thinking
            // token count in the final event); the UI groups reasoning parts
            // into one block regardless of order.
            if (!ev.text) continue;
            if (!reasoningOpen) {
              controller.enqueue({ type: "reasoning-start", id: reasoningId });
              reasoningOpen = true;
            }
            controller.enqueue({ type: "reasoning-delta", id: reasoningId, delta: ev.text });
          } else if (ev.type === "usage") {
            for (const k of Object.keys(ev.usage) as (keyof CliUsage)[]) {
              const v = ev.usage[k];
              if (typeof v === "number") usage[k] = (usage[k] ?? 0) + v;
            }
          } else if (ev.type === "retry") {
            retries++;
            if (retries >= MAX_RETRIES && !sawOutput) {
              stop(`${def.label} keeps retrying its API call (${retries}×) without answering. Run \`${def.bin}\` in a terminal to check its login.`);
            }
          } else {
            errorMsg = ev.message;
          }
        }
      });
      rl.on("close", () => {
        linesDone = true;
        finish();
      });
      proc.stderr!.on("data", (d) => {
        lastActivity = Date.now();
        stderr += String(d);
      });
      proc.on("error", (err) => {
        errorMsg = `${def.label} could not be started (${err.message}). Is \`${def.bin}\` installed and on PATH?`;
        exited = true;
        exitCode = -1;
        linesDone = true;
        finish();
      });
      proc.on("close", (code) => {
        exitCode = code;
        exited = true;
        finish();
      });
      proc.stdin!.on("error", () => {
        // EPIPE when the tool exits before reading; surfaced via exit code.
      });
      proc.stdin!.end(spec.stdin ?? "");
      signal?.addEventListener("abort", () => proc.kill("SIGTERM"), { once: true });
    },
    cancel() {
      child?.kill("SIGTERM");
    },
  });
}

/** An AI SDK model that runs `def.bin` per request. */
export function createCliModel(def: CliProviderDef, modelArg: string): LanguageModelV3 {
  const doStream = async (options: LanguageModelV3CallOptions) => {
    const flat = flattenPrompt(options.prompt);
    const warnings = [...flat.warnings];
    const tools =
      options.toolChoice?.type === "none"
        ? []
        : (options.tools ?? []).filter((t): t is FunctionTool => t.type === "function");
    if ((options.tools ?? []).some((t) => t.type !== "function")) {
      warnings.push({ type: "unsupported", feature: "provider-defined tools", details: "CLI providers only support function tools" });
    }
    const system = [flat.system, tools.length ? buildToolInstructions(tools) : ""].filter(Boolean).join("\n\n");
    const effort = options.providerOptions?.[def.id]?.effort;
    const spec = def.invoke({
      model: modelArg,
      system,
      user: flat.user,
      effort: typeof effort === "string" && effort ? effort : undefined,
    });
    const toolNames = new Set(tools.map((t) => t.name));
    return { stream: runCli(def, spec, warnings, options.abortSignal, toolNames) };
  };

  return {
    specificationVersion: "v3",
    provider: def.id,
    modelId: modelArg,
    supportedUrls: {},
    doStream,
    async doGenerate(options): Promise<GenerateResult> {
      const { stream } = await doStream(options);
      const reader = stream.getReader();
      let text = "";
      let warnings: Warning[] = [];
      let error: unknown;
      let usage: Usage = toUsage({});
      let finishReason: GenerateResult["finishReason"] = { unified: "stop", raw: undefined };
      const content: GenerateResult["content"] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.type === "stream-start") warnings = value.warnings;
        else if (value.type === "text-delta") text += value.delta;
        else if (value.type === "tool-call") content.push(value);
        else if (value.type === "error") error = value.error;
        else if (value.type === "finish") {
          usage = value.usage;
          finishReason = value.finishReason;
        }
      }
      if (error) throw error instanceof Error ? error : new Error(String(error));
      if (text) content.unshift({ type: "text", text });
      return { content, finishReason, usage, warnings };
    },
  };
}
