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

/** Coding-agent CLIs as chat providers: launched headless so each keeps its own login
 *  (subscription logins are licensed to the issuing tool). Local server only. */

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
  | { type: "retry" }
  /** A tool the CLI ran itself (Claude Code's Read/Edit/…), shown as a provider-executed call. */
  | { type: "tool-call"; id: string; name: string; input: unknown }
  | { type: "tool-result"; id: string; name: string; result: unknown; isError: boolean };

export interface CliInvocation {
  model: string;
  system: string;
  user: string;
  /** low | medium | high | max, from the conversation's reasoning-effort setting. */
  effort?: string;
  /** Working folder the tool may use; absent = sandboxed scratch dir, no file tools. */
  cwd?: string;
  /** chat and plan = read-only tools in `cwd` (plan also asks Claude Code for plan mode); agent = may also create/edit files there. */
  access?: "chat" | "plan" | "agent";
}

export interface CliProviderDef {
  /** Model-id prefix, e.g. `claude-code/sonnet`. */
  id: string;
  label: string;
  bin: string;
  contextWindow: number;
  /** Fixed list, or "discover" to ask the tool (currently `opencode models`). */
  models: CliModel[] | "discover";
  invoke(p: CliInvocation): { args: string[]; stdin?: string; env?: Record<string, string>; cwd?: string };
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
  // tool_use id → tool name, so results (which only carry the id) can be labelled.
  const toolNames = new Map<string, string>();
  return (line) => {
    const e = json(line);
    if (!e) return [];
    if (e.type === "stream_event") {
      const ev = e.event;
      const d = ev?.delta;
      if (ev?.type === "content_block_delta" && d?.type === "text_delta" && typeof d.text === "string") {
        streamed = true;
        return [{ type: "text", text: d.text }];
      }
      // Thinking content is redacted, but knowing it started lets the UI show
      // a live "Thinking…" block instead of an empty bubble.
      if (ev?.type === "content_block_start" && ev.content_block?.type === "thinking") {
        return [{ type: "reasoning", text: "Thinking…" }];
      }
      return [];
    }
    if (e.type === "system") return e.subtype === "api_retry" ? [{ type: "retry" }] : [];
    if (e.type === "assistant") {
      const blocks: any[] = e.message?.content ?? [];
      const out: CliEvent[] = [];
      for (const b of blocks) {
        if (b?.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string") {
          toolNames.set(b.id, b.name);
          out.push({ type: "tool-call", id: b.id, name: b.name, input: b.input ?? {} });
        }
      }
      // Older versions without partial messages: whole assistant messages.
      if (!streamed) {
        const text = blocks
          .filter((p) => p?.type === "text" && typeof p.text === "string")
          .map((p) => p.text)
          .join("");
        if (text) out.push({ type: "text", text });
      }
      return out;
    }
    if (e.type === "user") {
      // Results of the tools Claude Code ran come back as user-role messages.
      return ((e.message?.content ?? []) as any[])
        .filter((b) => b?.type === "tool_result" && typeof b.tool_use_id === "string")
        .map((b) => ({
          type: "tool-result" as const,
          id: b.tool_use_id as string,
          name: toolNames.get(b.tool_use_id) ?? "tool",
          result: b.content ?? "",
          isError: !!b.is_error,
        }));
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
    // --setting-sources "" skips the user's hooks/settings; --system-prompt replaces the
    // coding-agent prompt. Tool access widens with the working folder and mode.
    invoke: ({ model, system, user, effort, cwd, access }) => ({
      args: [
        "-p",
        "--output-format", "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--no-session-persistence",
        "--setting-sources", "",
        ...(!cwd
          ? ["--tools", ""]
          : access === "agent"
            ? ["--tools", "default", "--permission-mode", "acceptEdits"]
            : ["--tools", "Read", "Glob", "Grep", "WebSearch", "WebFetch"]),
        ...(access === "plan" ? ["--permission-mode", "plan"] : []),
        ...(system ? ["--system-prompt", system] : []),
        ...(model !== "default" ? ["--model", model] : []),
        ...(effort ? ["--effort", effort] : []),
      ],
      stdin: user,
      cwd,
    }),
    parser: claudeParser,
  },
  {
    id: "codex",
    label: "Codex",
    bin: "codex",
    contextWindow: 200_000,
    models: [{ id: "default", name: "Default (your Codex setting)" }],
    invoke: ({ model, system, user, effort, cwd, access }) => ({
      args: [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--sandbox", cwd && access === "agent" ? "workspace-write" : "read-only",
        ...(cwd ? ["-C", cwd] : []),
        ...(model !== "default" ? ["--model", model] : []),
        ...(effort ? ["-c", `model_reasoning_effort="${effort === "max" ? "high" : effort}"`] : []),
        "-",
      ],
      stdin: withSystem(system, user),
      cwd,
    }),
    parser: codexParser,
  },
  {
    id: "opencode",
    label: "OpenCode",
    bin: "opencode",
    contextWindow: 128_000,
    models: "discover",
    invoke: ({ model, system, user, effort, cwd, access }) => ({
      args: [
        "run",
        "--format", "json",
        "--pure",
        "--thinking",
        ...(cwd ? ["--dir", cwd] : []),
        ...(model !== "default" ? ["--model", model] : []),
        ...(effort ? ["--variant", effort] : []),
        "--",
        withSystem(system, user),
      ],
      env: {
        // Shell is never allowed; edits only with a folder in agent mode; web
        // fetch only with a folder (mirrors Claude Code's tool set above).
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          permission: {
            bash: "deny",
            edit: cwd && access === "agent" ? "allow" : "deny",
            webfetch: cwd ? "allow" : "deny",
          },
        }),
      },
      cwd,
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

// DevChat's own provider env must not leak into the tool: Claude Code prefers
// ANTHROPIC_API_KEY over its subscription login and then retries a bad key forever.
const STRIPPED_ENV = new Set([
  ...PROVIDERS.map((p) => p.envKey),
  ...PROVIDERS.flatMap((p) => (p.envBaseUrl ? [p.envBaseUrl] : [])),
  ...Object.keys(ENV_ALIASES),
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_URL",
]);

/** Start the dev server from inside Claude Code and these leak in, making the
 *  spawned run think it is a nested child instead of a fresh session. */
function isSessionVar(key: string): boolean {
  return (
    key === "CLAUDECODE" ||
    key === "CLAUDE_PID" ||
    key.startsWith("CLAUDE_CODE_") ||
    key.startsWith("CLAUDE_AGENT_")
  );
}

export function childEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra, PATH: searchPath() };
  for (const k of Object.keys(env)) if (STRIPPED_ENV.has(k) || isSessionVar(k)) delete env[k];
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

/** CLIs take one prompt string, so history is flattened into a transcript. System
 *  messages go separately, via a flag or prepended by `invoke`. */
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
        (sawTools
          ? " Tool results below are the outcomes of tool calls you made; use them to answer in prose now," +
            " and do not repeat a tool call you already made with the same arguments."
          : "") +
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

// CLIs return text with their own tools off, so DevChat's tools are a prompt protocol:
// the model emits a ```tool_call fence, the scanner below turns it into an SDK call.

const FENCE = "```tool_call";
/** Shown in place of a block that opened like a tool call but could not be read as one. */
const BAD_CALL = "(tool call could not be parsed)";

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

// Models fluff the protocol, so markers are read loosely: fenced or bare, Cyrillic
// lookalikes folded, plus Anthropic's `<function_calls>` wrapper, else calls leak as text.
const XML_MARKER = "<function_calls>";
const MARKER_RE = /(?:`{3,}[ \t]*|\n[ \t]*)tool_call\b[ \t]*|<function_calls>[ \t]*/i;
/** Whatever closes a call block, stripped once its arguments have been read. */
const CLOSER_RE = /^[ \t]*\n?[ \t]*(?:`{3,}|<\/function_calls>)[ \t]*/;
const HOMOGLYPHS: Record<string, string> = { "т": "t", "о": "o", "а": "a", "с": "c", "ӏ": "l" };
const deHomoglyph = (s: string) => s.replace(/[тоасӏ]/g, (c) => HOMOGLYPHS[c]);

/** Length of the tail of `s` that could still grow into a marker. */
function partialMarkerLen(s: string): number {
  const n = deHomoglyph(s);
  const lineAt = n.lastIndexOf("\n") + 1;
  for (let k = Math.min(Math.max(FENCE.length, XML_MARKER.length) - 1, n.length); k > 0; k--) {
    const tail = n.slice(-k);
    // A fenced marker can start mid-line; a bare one only at a line start.
    if (FENCE.startsWith(tail) || XML_MARKER.startsWith(tail)) return k;
    if ("tool_call".startsWith(tail) && /^[ \t]*$/.test(n.slice(lineAt, n.length - k))) return k;
  }
  return 0;
}

/** Index just past the balanced object starting at `start`, or 0 if it is still incomplete. */
function objectEnd(s: string, start: number): number {
  let depth = 0;
  let str = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (esc) esc = false;
    else if (str) {
      if (c === "\\") esc = true;
      else if (c === '"') str = false;
    } else if (c === '"') str = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i + 1;
  }
  return 0;
}

/** Splits streamed text into text and at most one tool call, holding back partial markers.
 *  Anything after a completed call is dropped — it predates the tool result. */
export class ToolCallScanner {
  private buf = "";
  /** The marker text itself, kept so a block that turns out not to be a call reads normally. */
  private head = "";
  private inTool = false;
  private lineStart = true;
  private done = false;

  constructor(private readonly names: Set<string>) {}

  push(delta: string): { text: string; call?: ParsedToolCall } {
    if (this.done) return { text: "" };
    this.buf += delta;
    if (this.inTool) {
      const r = this.tryClose();
      return { text: r.text ?? "", call: r.call };
    }
    // One character of context, so a marker at the very start of the buffer
    // counts as line-initial only when the buffer really is at a line start.
    const m = MARKER_RE.exec((this.lineStart ? "\n" : " ") + deHomoglyph(this.buf));
    if (!m) {
      // Hold back a possible partial marker at the tail, and the whitespace
      // just before it, so neither leaks if a tool call follows.
      let keep = partialMarkerLen(this.buf);
      const before = this.buf.slice(0, this.buf.length - keep);
      keep += before.length - before.trimEnd().length;
      const text = this.buf.slice(0, this.buf.length - keep);
      this.buf = this.buf.slice(this.buf.length - keep);
      if (text) this.lineStart = text.endsWith("\n");
      return { text };
    }
    const at = Math.max(0, m.index - 1);
    const bodyAt = m.index + m[0].length - 1;
    const text = this.buf.slice(0, at).replace(/\s+$/, "");
    this.head = this.buf.slice(at, bodyAt);
    this.buf = this.buf.slice(bodyAt);
    this.inTool = true;
    const r = this.tryClose();
    return { text: text + (r.text ?? ""), call: r.call };
  }

  end(): { text: string; call?: ParsedToolCall } {
    if (this.done) return { text: "" };
    if (!this.inTool) {
      const text = this.buf;
      this.buf = "";
      return { text };
    }
    const raw = this.head + this.buf;
    const started = this.buf.includes("{");
    const r = this.tryClose();
    this.done = true;
    this.buf = "";
    if (r.call) return { text: "", call: r.call };
    if (r.text) return { text: r.text };
    // Truncated arguments are a failed call; a marker with no JSON at all was
    // never one, so keep that as text.
    return { text: started ? BAD_CALL : raw };
  }

  private tryClose(): { text?: string; call?: ParsedToolCall } {
    const start = this.buf.indexOf("{");
    const end = start < 0 ? 0 : objectEnd(this.buf, start);
    if (end <= 0) return {}; // no arguments yet, or still arriving
    const call = this.parse(this.buf.slice(start, end));
    if (call) {
      this.done = true;
      this.buf = "";
      return { call };
    }
    // It clearly was an attempted call, so say so rather than leak the
    // protocol into the answer, and keep scanning after it.
    this.buf = this.buf.slice(end).replace(CLOSER_RE, "");
    this.head = "";
    this.inTool = false;
    this.lineStart = false;
    return { text: BAD_CALL };
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
      const scratch = join(tmpdir(), "devchat-cli");
      await mkdir(scratch, { recursive: true });
      const cwd = spec.cwd || scratch;

      child = spawn(def.bin, spec.args, { cwd, env: childEnv(spec.env), stdio: ["pipe", "pipe", "pipe"] });
      const proc = child;
      const parse = def.parser();
      const scanner = toolNames?.size ? new ToolCallScanner(toolNames) : null;
      // Text and reasoning parts can open and close several times around
      // provider-run tool calls; each needs a fresh id.
      let textSeq = 0;
      let reasoningSeq = 0;
      let textId = "";
      let reasoningId = "";
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
      const emitReasoning = (text: string) => {
        if (!text) return;
        if (!reasoningOpen) {
          reasoningId = `reasoning-${++reasoningSeq}`;
          controller.enqueue({ type: "reasoning-start", id: reasoningId });
          reasoningOpen = true;
        }
        controller.enqueue({ type: "reasoning-delta", id: reasoningId, delta: text });
      };
      const emitText = (text: string) => {
        if (!text) return;
        closeReasoning();
        sawOutput = true;
        if (!textOpen) {
          textId = `text-${++textSeq}`;
          controller.enqueue({ type: "text-start", id: textId });
          textOpen = true;
        }
        controller.enqueue({ type: "text-delta", id: textId, delta: text });
      };
      const closeText = () => {
        if (textOpen) {
          controller.enqueue({ type: "text-end", id: textId });
          textOpen = false;
        }
      };
      const emitScan = ({ text, call }: { text: string; call?: ParsedToolCall }) => {
        emitText(text);
        if (!call) return;
        closeText();
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
        closeText();
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
            // May arrive after the answer; the UI groups reasoning parts into one
            // block regardless of order.
            emitReasoning(ev.text);
          } else if (ev.type === "tool-call") {
            // The CLI ran this itself; `dynamic` because it isn't one of the
            // tools DevChat handed to streamText.
            closeReasoning();
            closeText();
            sawOutput = true;
            controller.enqueue({
              type: "tool-call",
              toolCallId: ev.id,
              toolName: ev.name,
              input: JSON.stringify(ev.input ?? {}),
              providerExecuted: true,
              dynamic: true,
            });
          } else if (ev.type === "tool-result") {
            controller.enqueue({
              type: "tool-result",
              toolCallId: ev.id,
              toolName: ev.name,
              result: (ev.result ?? "") as NonNullable<Extract<StreamPart, { type: "tool-result" }>["result"]>,
              isError: ev.isError,
              dynamic: true,
            });
          } else if (ev.type === "usage") {
            for (const k of Object.keys(ev.usage) as (keyof CliUsage)[]) {
              const v = ev.usage[k];
              if (typeof v === "number") usage[k] = (usage[k] ?? 0) + v;
            }
          } else if (ev.type === "retry") {
            retries++;
            // Otherwise the bubble just sits there: the tool is alive but its
            // upstream API isn't answering, and only we can see that.
            emitReasoning(`Waiting for ${def.label}'s API (retry ${retries})…\n`);
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
    const po = options.providerOptions?.[def.id] ?? {};
    const effort = typeof po.effort === "string" && po.effort ? po.effort : undefined;
    const cwd = typeof po.cwd === "string" && po.cwd ? po.cwd : undefined;
    const access: "chat" | "plan" | "agent" = po.access === "agent" || po.access === "plan" ? po.access : "chat";
    const folderNote = cwd
      ? `## Working folder\nYou are working in the folder ${cwd}. Use paths relative to it or absolute paths inside it; other locations are not accessible.${
          access === "agent"
            ? " You may read, create and edit files here. Shell commands are not available."
            : " You may read and search files here but not change them."
        }`
      : "";
    const system = [flat.system, tools.length ? buildToolInstructions(tools) : "", folderNote]
      .filter(Boolean)
      .join("\n\n");
    const spec = def.invoke({ model: modelArg, system, user: flat.user, effort, cwd, access });
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
