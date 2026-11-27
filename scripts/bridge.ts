/**
 * Orrery local bridge: a small daemon on 127.0.0.1 that lets the hosted Orrery page use this machine's Claude Code.
 * The browser talks to it directly; every request is checked by `checkBridgeRequest` before its body is read.
 *
 *   npm run bridge                     start (first start creates ~/.orrery-bridge/config.json and prints the token once)
 *   npm run bridge -- --add <path>     allow a working folder        (--remove <path> to drop it)
 *   npm run bridge -- --origin <url>   allow another page origin
 *   npm run bridge -- --max-mode <chat|plan|agent|ask>   the most the page may do (default plan: read-only; agent edits; ask also runs commands)
 *   npm run bridge -- --no-confirm-shell | --confirm-shell   confirm each command in this terminal (default on)
 *   npm run bridge -- --allow-chat-wide-edits   let the page pre-approve edits for a whole chat (default off)
 *   npm run bridge -- --print-token    show the token again
 *
 * Folders are only ever added here, never over HTTP. The client sends no argv, env, binary path or permission strings:
 * it picks a model, a mode (capped by `maxMode`), a folder from the list and the chat messages.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { convertToModelMessages, streamText } from "ai";
import { z } from "zod";
import { BRIDGE_PORT, BRIDGE_PROTOCOL, checkBridgeRequest, corsHeaders } from "@/lib/bridge/protocol";
import { createInterface } from "node:readline";
import { CLI_PROVIDERS, createCliModel, findCliBins, killAllCliRuns, setShellConfirm } from "@/lib/cliProviders";
import { CHAT_MODES, MODE_POLICY, type ChatMode } from "@/lib/chat/modes";
import { normalizeMessageToolParts } from "@/lib/chat/normalizeToolParts";
import { refuseReason } from "@/lib/files/folderRules";
import { CHAT_ALLOWABLE_TOOLS } from "@/lib/utils/messageParts";

export const DEFAULT_ORIGIN = "https://dev-chat-beta.vercel.app";
const VERSION = "0.1.0";
const MAX_BODY = 2 * 1024 * 1024;
const MAX_CHATS = 4;
const PROVIDER_ID = "claude-code";

// ─── Config ────────────────────────────────────────────────────────────────

const ConfigSchema = z.object({
  token: z.string().min(32),
  origins: z.array(z.string()),
  folders: z.array(z.string()),
  maxMode: z.enum(CHAT_MODES),
  /** A command Claude Code wants to run is also confirmed (y/N) in this terminal, not just in the page. */
  confirmShell: z.boolean().default(true),
  /** Lets the page pre-approve edits for a whole chat ("Allow for this chat"); off, every edit asks. */
  allowChatWideEdits: z.boolean().default(false),
});
export type BridgeConfig = z.infer<typeof ConfigSchema>;

export const defaultConfigDir = () => join(homedir(), ".orrery-bridge");
const configFile = (dir: string) => join(dir, "config.json");

function writeConfig(dir: string, config: BridgeConfig) {
  const tmp = configFile(dir) + `.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, configFile(dir));
}

/** Reads the config, creating it (dir 0700, file 0600, fresh 256-bit token) on first use. `created` is true only then. */
export function ensureConfig(dir = defaultConfigDir()): { config: BridgeConfig; created: boolean } {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const file = configFile(dir);
  if (!existsSync(file)) {
    const config: BridgeConfig = { token: randomBytes(32).toString("base64url"), origins: [DEFAULT_ORIGIN], folders: [], maxMode: "plan", confirmShell: true, allowChatWideEdits: false };
    writeConfig(dir, config);
    return { config, created: true };
  }
  if (statSync(file).mode & 0o077) chmodSync(file, 0o600);
  return { config: ConfigSchema.parse(JSON.parse(readFileSync(file, "utf8"))), created: false };
}

/** Resolves a typed path to a real folder the refuse rules accept (same rules as the web app's Choose folder). */
async function resolveFolderArg(raw: string): Promise<string> {
  const p = raw === "~" || raw.startsWith("~/") ? join(homedir(), raw.slice(1)) : raw;
  if (!isAbsolute(p)) throw new Error(`${raw} is not a full path.`);
  const real = await realpath(p).catch(() => null);
  if (!real || !(await stat(real)).isDirectory()) throw new Error(`No folder at ${raw}`);
  const refused = await refuseReason(real);
  if (refused) throw new Error(refused);
  return real;
}

// ─── Server ────────────────────────────────────────────────────────────────

const Body = z.object({
  messages: z
    .array(z.object({ id: z.string().optional(), role: z.enum(["user", "assistant", "system"]), parts: z.array(z.record(z.string(), z.unknown())) }).passthrough())
    .min(1)
    .max(1000),
  conversationId: z.string().max(200).optional(),
  model: z.string().max(200),
  mode: z.enum(CHAT_MODES).default("chat"),
  allowedTools: z.array(z.string().max(100)).max(50).default([]),
  folder: z.string().max(1000).optional(),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  system: z.string().max(64_000).optional(),
});

export interface BridgeDeps {
  port?: number;
  /** Asks the person at the terminal about one command: true = yes, "no-tty" = nobody to ask. Defaults to `terminalConfirm()`. */
  confirm?: ConfirmShell;
  /** Ids of installed CLI providers; defaults to a PATH search. */
  findBins?: () => Promise<Set<string>>;
  log?: (line: string) => void;
}

const claudeDef = CLI_PROVIDERS.find((d) => d.id === PROVIDER_ID)!;
const modelList = () => claudeDef.models === "discover" ? [] : claudeDef.models.map((m) => ({ id: `${PROVIDER_ID}/${m.id}`, name: m.name, provider: claudeDef.label, contextWindow: claudeDef.contextWindow }));
// By risk, lowest first: ask is the only mode that can run shell commands, so it ranks above agent (edits only).
const MODE_RANK: Record<ChatMode, number> = { chat: 0, plan: 1, agent: 2, ask: 3 };

/** One line for `--max-mode`: what that mode lets the page do. */
export function modeNote(mode: ChatMode): string {
  const what: Record<ChatMode, string> = {
    chat: "Claude Code answers without tools.",
    plan: "read-only: Claude Code can read and search the allowed folders and change nothing.",
    agent: "Claude Code can also create and edit files in the allowed folders without asking. It cannot run commands.",
    ask: "Claude Code can also run shell commands in the allowed folders; every edit or command needs approval in the page, and every command is confirmed here in this terminal.",
  };
  return `Max mode ${mode}: ${what[mode]}`;
}

export type ConfirmShell = (q: { tool: string; command: string; folder: string }) => Promise<boolean | "no-tty">;

/** y/N on the daemon's own stdin, one question at a time. No answer within `timeoutMs` (60 s) is a no; no TTY is "no-tty". */
export function terminalConfirm(io: { stdin?: NodeJS.ReadStream; stdout?: NodeJS.WriteStream; timeoutMs?: number } = {}): ConfirmShell {
  const stdin = io.stdin ?? process.stdin;
  const stdout = io.stdout ?? process.stdout;
  let queue: Promise<unknown> = Promise.resolve();
  const ask: ConfirmShell = async ({ tool, command, folder }) => {
    if (!stdin.isTTY) return "no-tty";
    // The command is the model's text: control characters (escape sequences) must not redraw this prompt.
    const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "?");
    stdout.write(`\nClaude Code wants to run (${tool}) in ${clean(folder)}:\n  ${clean(command).split("\n").join("\n  ")}\n`);
    const rl = createInterface({ input: stdin, output: stdout });
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        stdout.write("\nNo answer in 60 s: denied.\n");
        rl.close();
        resolve(false);
      }, io.timeoutMs ?? 60_000);
      rl.question("Run it? [y/N] ", (a) => {
        clearTimeout(timer);
        rl.close();
        resolve(/^y(es)?$/i.test(a.trim()));
      });
    });
  };
  return (q) => {
    const next = queue.then(() => ask(q));
    queue = next.catch(() => undefined);
    return next;
  };
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "Request body is over 2 MB");
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

/** `config` may be a function so edits made with --add while the bridge runs apply on the next request. */
export function createBridgeServer(config: BridgeConfig | (() => BridgeConfig), deps: BridgeDeps = {}): Server {
  const getConfig = typeof config === "function" ? config : () => config;
  const log = deps.log ?? ((l: string) => console.log(l));
  const findBins = deps.findBins ?? findCliBins;
  const confirm = deps.confirm ?? terminalConfirm();
  // Config problems are logged without the file's content (it holds the token).
  const originsOf = new WeakMap<IncomingMessage, readonly string[]>();
  // A shell approval from the page is not enough: the person at this terminal confirms the command too.
  setShellConfirm(async ({ toolName, input, cwd }) => {
    try {
      if (!getConfig().confirmShell) return { ok: true };
    } catch {
      return { ok: false, message: "The bridge's config could not be read, so the command was not run." };
    }
    const i = (input ?? {}) as { command?: unknown };
    const answer = await confirm({ tool: toolName, command: typeof i.command === "string" ? i.command : JSON.stringify(input), folder: cwd });
    if (answer === true) return { ok: true };
    return {
      ok: false,
      message:
        answer === "no-tty"
          ? "This command needs confirmation in the bridge's terminal, but the bridge has no terminal. Start it from a terminal, or run `npm run bridge -- --no-confirm-shell`."
          : "The command was not confirmed in the bridge's terminal.",
    };
  });
  let chats = 0;

  const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
    res.end(JSON.stringify(body));
  };

  async function chat(req: IncomingMessage, res: ServerResponse, cfg: BridgeConfig, cors: Record<string, string>) {
    if (chats >= MAX_CHATS) return send(res, 429, { error: "Too many chats are running. Wait for one to finish." }, cors);
    // The slot is taken before the first await, so parallel slow-body requests cannot get past the cap, and the first
    // close of the connection (also during the body read) frees it and aborts the run.
    chats++;
    const abort = new AbortController();
    res.once("close", () => {
      chats--;
      if (!res.writableFinished) abort.abort();
    });
    const parsed = Body.safeParse(await readBody(req));
    if (!parsed.success) return send(res, 400, { error: "Invalid request", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, cors);
    const b = parsed.data;
    const known = modelList().find((m) => m.id === b.model);
    if (!known) return send(res, 400, { error: "Unknown model" }, cors);
    // Re-checked every turn: the folder may since have been removed, swapped for a symlink or now match a refuse rule.
    let cwd = "";
    if (b.folder) {
      const real = await realpath(b.folder).catch(() => null);
      if (!real || !cfg.folders.includes(real) || (await refuseReason(real))) return send(res, 403, { error: "That folder is not on the bridge's list." }, cors);
      cwd = real;
    }
    const mode: ChatMode = MODE_RANK[b.mode] > MODE_RANK[cfg.maxMode] ? cfg.maxMode : b.mode;

    // Only text is taken from a user message: a file or URL part would make the daemon fetch it.
    const stripped = b.messages.map((m) => ({
      ...m,
      parts: m.parts.filter((p) => (m.role === "user" ? p.type === "text" : !["file", "source-url", "source-document"].includes(String(p.type)))),
    }));
    const messages = normalizeMessageToolParts(stripped);
    const modelMessages = await convertToModelMessages(messages as never);
    if (res.destroyed) return;
    const result = streamText({
      model: createCliModel(claudeDef, known.id.slice(PROVIDER_ID.length + 1)),
      system: b.system,
      messages: modelMessages,
      maxRetries: 0,
      abortSignal: abort.signal,
      // Same keys as providerOptionsFor() in src/lib/chat/providerOptions.ts. The userId only lets the parked-run cap apply.
      providerOptions: {
        [PROVIDER_ID]: {
          effort: b.effort ?? "",
          cwd,
          access: MODE_POLICY[mode].cli,
          conversationId: b.conversationId ?? "",
          userId: "bridge",
          // Chat-wide pre-approval of edits is off unless the owner turned it on here.
          allowedTools: cfg.allowChatWideEdits ? b.allowedTools.filter((t) => CHAT_ALLOWABLE_TOOLS.has(t)) : [],
          // No user-scope MCP servers or connectors in a bridge run.
          strictMcp: true,
        },
      },
    });
    result.pipeUIMessageStreamToResponse(res, {
      headers: cors,
      onError: (e) => (e instanceof Error ? e.message : String(e)),
    });
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    let cfg: BridgeConfig;
    try {
      cfg = getConfig();
    } catch (e) {
      // A half-written or broken config.json: answer 500 (no CORS headers, no config content) and keep serving.
      log(`error: config.json is unreadable (${e instanceof Error ? e.name : "error"}): fix or delete it`);
      return send(res, 500, { error: "Bridge config is unreadable" });
    }
    originsOf.set(req, cfg.origins);
    const port = (res.socket?.localPort ?? deps.port ?? BRIDGE_PORT) as number;
    const origin = req.headers.origin;
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const verdict = checkBridgeRequest(
      { method: req.method, host: req.headers.host, origin, authorization: req.headers.authorization, contentType: req.headers["content-type"] },
      { token: cfg.token, origins: cfg.origins, port },
    );
    const cors = corsHeaders(origin, cfg.origins);
    if (req.method === "OPTIONS" && verdict.ok) {
      res.writeHead(204, corsHeaders(origin, cfg.origins, true));
      return res.end();
    }
    // /health answers a paired page's probe: without a valid token only the protocol number comes back.
    if (req.method === "GET" && url.pathname === "/health" && (verdict.ok || verdict.status === 401)) {
      if (!verdict.ok) return send(res, 200, { protocol: BRIDGE_PROTOCOL }, cors);
      return send(res, 200, { protocol: BRIDGE_PROTOCOL, version: VERSION, claude: (await findBins()).has(PROVIDER_ID) }, cors);
    }
    if (!verdict.ok) return send(res, verdict.status, { error: verdict.reason }, cors);
    if (req.method === "GET" && url.pathname === "/models") return send(res, 200, { models: modelList() }, cors);
    if (req.method === "GET" && url.pathname === "/folders") {
      return send(res, 200, { folders: cfg.folders.map((path) => ({ path, source: "added" })), hostTools: true, reason: null }, cors);
    }
    if (req.method === "POST" && url.pathname === "/chat") return chat(req, res, cfg, cors);
    return send(res, 404, { error: "Not found" }, cors);
  }

  return createServer((req, res) => {
    handle(req, res)
      .catch((e) => {
        const status = e instanceof HttpError ? e.status : 500;
        if (status === 500) log(`error: ${e instanceof Error ? e.message : "unknown"}`);
        if (!res.headersSent) send(res, status, { error: status === 500 ? "Bridge error" : (e as Error).message }, corsHeaders(req.headers.origin, originsOf.get(req) ?? []));
        else res.end();
      })
      .finally(() => log(`${req.method} ${(req.url ?? "").split("?")[0]} ${res.statusCode}`));
  });
}

// ─── CLI ───────────────────────────────────────────────────────────────────

const pairing = (token: string) =>
  [
    "Orrery bridge: pair this machine with your Orrery page.",
    `  Token: ${token}`,
    "  Paste it into Orrery (Settings > Local bridge). It is shown only now; `npm run bridge -- --print-token` shows it again.",
    "  Add a working folder with: npm run bridge -- --add /path/to/project",
  ].join("\n");

export async function main(argv = process.argv.slice(2), dir = defaultConfigDir()) {
  const arg = (flag: string) => {
    const i = argv.indexOf(flag);
    if (i < 0) return undefined;
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) throw new Error(`${flag} needs a value.`);
    return v;
  };
  const { config, created } = ensureConfig(dir);
  if (argv.includes("--print-token")) return console.log(config.token);
  const add = arg("--add");
  const remove = arg("--remove");
  const origin = arg("--origin");
  const maxMode = arg("--max-mode");
  const confirmFlag = argv.includes("--confirm-shell");
  const noConfirmFlag = argv.includes("--no-confirm-shell");
  const chatEditsFlag = argv.includes("--allow-chat-wide-edits");
  if (add || remove || origin || maxMode || confirmFlag || noConfirmFlag || chatEditsFlag) {
    if (maxMode) {
      if (!(CHAT_MODES as readonly string[]).includes(maxMode)) throw new Error(`--max-mode must be one of: ${CHAT_MODES.join(", ")}`);
      config.maxMode = maxMode as ChatMode;
      console.log(modeNote(config.maxMode));
    }
    if (confirmFlag) config.confirmShell = true;
    if (noConfirmFlag) {
      config.confirmShell = false;
      console.log("Shell commands are no longer confirmed in this terminal: the page's approval alone runs them.");
    }
    if (chatEditsFlag) {
      config.allowChatWideEdits = true;
      console.log("The page may now pre-approve edits for a whole chat.");
    }
    if (add) {
      const real = await resolveFolderArg(add);
      if (!config.folders.includes(real)) config.folders.push(real);
      console.log(`Added ${real}`);
    }
    if (remove) {
      const real = await realpath(remove).catch(() => remove);
      config.folders = config.folders.filter((f) => f !== real && f !== remove);
      console.log(`Removed ${remove}`);
    }
    if (origin) {
      const u = new URL(origin);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Origin must be an http(s) URL.");
      if (!config.origins.includes(u.origin)) config.origins.push(u.origin);
      console.log(`Allowed origin ${u.origin}`);
    }
    return writeConfig(dir, config);
  }
  if (created) console.log(pairing(config.token));
  const server = createBridgeServer(() => ensureConfig(dir).config, {});
  server.on("error", (e) => {
    console.error(`Could not listen on 127.0.0.1:${BRIDGE_PORT}: ${e.message}`);
    process.exit(1);
  });
  // Claude Code processes (running or waiting on a card) must not outlive the daemon.
  process.once("exit", killAllCliRuns);
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      killAllCliRuns();
      server.close();
      process.exit(0);
    });
  }
  server.listen(BRIDGE_PORT, "127.0.0.1", () => console.log(`Orrery bridge listening on http://127.0.0.1:${BRIDGE_PORT} (${config.folders.length} folder(s), max mode ${config.maxMode})`));
}

if (process.argv[1] && /bridge\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
