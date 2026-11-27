/**
 * Orrery local bridge: a small daemon on 127.0.0.1 that lets the hosted Orrery page use this machine's Claude Code.
 * The browser talks to it directly; every request is checked by `checkBridgeRequest` before its body is read.
 *
 *   npm run bridge                     start (first start creates ~/.orrery-bridge/config.json and prints the token once)
 *   npm run bridge -- --add <path>     allow a working folder        (--remove <path> to drop it)
 *   npm run bridge -- --origin <url>   allow another page origin
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
import { CLI_PROVIDERS, createCliModel, findCliBins } from "@/lib/cliProviders";
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
    const config: BridgeConfig = { token: randomBytes(32).toString("base64url"), origins: [DEFAULT_ORIGIN], folders: [], maxMode: "ask" };
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
  /** Ids of installed CLI providers; defaults to a PATH search. */
  findBins?: () => Promise<Set<string>>;
  log?: (line: string) => void;
}

const claudeDef = CLI_PROVIDERS.find((d) => d.id === PROVIDER_ID)!;
const modelList = () => claudeDef.models === "discover" ? [] : claudeDef.models.map((m) => ({ id: `${PROVIDER_ID}/${m.id}`, name: m.name, provider: claudeDef.label, contextWindow: claudeDef.contextWindow }));
const MODE_RANK: Record<ChatMode, number> = { chat: 0, plan: 1, ask: 2, agent: 3 };

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
  // Signs approval requests so the browser cannot change an approved tool's input. New on every start.
  const approvalSecret = randomBytes(32).toString("hex");
  let chats = 0;

  const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
    res.end(JSON.stringify(body));
  };

  async function chat(req: IncomingMessage, res: ServerResponse, cfg: BridgeConfig, cors: Record<string, string>) {
    if (chats >= MAX_CHATS) return send(res, 429, { error: "Too many chats are running. Wait for one to finish." }, cors);
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

    const abort = new AbortController();
    const messages = normalizeMessageToolParts(b.messages.filter((m) => m.role !== ("compression" as string)));
    const modelMessages = await convertToModelMessages(messages as never);
    const result = streamText({
      model: createCliModel(claudeDef, known.id.slice(PROVIDER_ID.length + 1)),
      system: b.system,
      messages: modelMessages,
      experimental_toolApprovalSecret: approvalSecret,
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
          allowedTools: b.allowedTools.filter((t) => CHAT_ALLOWABLE_TOOLS.has(t)),
        },
      },
    });
    chats++;
    // A closed connection before the reply finished is a Stop: abort the run. A parked approval run stays parked.
    res.on("close", () => {
      chats--;
      if (!res.writableFinished) abort.abort();
    });
    result.pipeUIMessageStreamToResponse(res, {
      headers: cors,
      onError: (e) => (e instanceof Error ? e.message : String(e)),
    });
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const cfg = getConfig();
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
        if (!res.headersSent) send(res, status, { error: status === 500 ? "Bridge error" : (e as Error).message }, corsHeaders(req.headers.origin, getConfig().origins));
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
  if (add || remove || origin) {
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
  server.listen(BRIDGE_PORT, "127.0.0.1", () => console.log(`Orrery bridge listening on http://127.0.0.1:${BRIDGE_PORT} (${config.folders.length} folder(s), max mode ${config.maxMode})`));
}

if (process.argv[1] && /bridge\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
