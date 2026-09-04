import { randomBytes } from "crypto";
import type { NextRequest } from "next/server";
import { prisma } from "./db";
import { setSettingsKey } from "./settings";
import { PROVIDERS } from "./providers";
import { ENV_ALIASES, OPENCODE_IDS, SCAN_FILES, KEY_VALUE, PLACEHOLDER } from "./providerDetect";

/** "Connect this computer" for hosted deployments: a terminal script sends approved keys
 *  back. The code is the only auth, so it is short-lived, single-use, and add-key-only. */

const PAIR_TTL_MS = 10 * 60_000;
const PREFIX = "pairingCode:";
// No 0/O/1/I/l so the code survives being read aloud or retyped.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export async function createPairingCode(userId: string): Promise<string> {
  await prisma.appSetting.deleteMany({ where: { userId, key: { startsWith: PREFIX } } });
  const bytes = randomBytes(10);
  let code = "";
  for (const b of bytes) code += ALPHABET[b % ALPHABET.length];
  await prisma.appSetting.create({
    data: { userId, key: PREFIX + code, value: String(Date.now() + PAIR_TTL_MS) },
  });
  return code;
}

/** Saves approved keys for the code's owner; null when the code is unknown, used, or
 *  expired. The code is consumed on first use either way. */
export async function redeemPairingCode(
  code: string,
  items: Array<{ providerId?: unknown; apiKey?: unknown }>,
): Promise<string[] | null> {
  const row = await prisma.appSetting.findFirst({ where: { key: PREFIX + code } });
  if (!row?.userId) return null;
  await prisma.appSetting.delete({ where: { id: row.id } });
  if (Number(row.value) < Date.now()) return null;

  const imported: string[] = [];
  for (const item of items) {
    const def = PROVIDERS.find((p) => p.id === item.providerId);
    const key = item.apiKey;
    if (!def || typeof key !== "string" || key.length < 20 || key.length > 512) continue;
    await setSettingsKey(row.userId, def.settingKey, key);
    imported.push(def.label);
  }
  return imported;
}

/** Public origin of this deployment, for the command shown to the user. */
export function appOrigin(req: NextRequest): string {
  if (process.env.AUTH_URL) {
    try {
      return new URL(process.env.AUTH_URL).origin;
    } catch {
      // fall through to headers
    }
  }
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** The script the user runs: plain Node, no dependencies. Provider data and patterns come
 *  from providerDetect.ts so there is one source of truth for what counts as a key. */
export function buildConnectScript(origin: string): string {
  const providers = PROVIDERS.map(({ id, label, envKey }) => ({ id, label, envKey }));
  return `#!/usr/bin/env node
// DevChat "connect this computer" — finds API keys that tools on this machine
// already store (Codex CLI, Claude Code, Gemini CLI, OpenCode, bb, shell
// profiles), asks you about each one, and sends ONLY the ones you approve to
// your DevChat account at ${origin}. OAuth logins are never read.
//
//   node connect.js <pairing-code>          ask about each key
//   node connect.js <pairing-code> --yes    import everything found
//   node connect.js --list                  only show what would be found
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const APP = ${JSON.stringify(origin)};
const PROVIDERS = ${JSON.stringify(providers)};
const ENV_ALIASES = ${JSON.stringify(ENV_ALIASES)};
const OPENCODE_IDS = ${JSON.stringify(OPENCODE_IDS)};
const FILES = ${JSON.stringify(SCAN_FILES)};
const KEY_VALUE = new RegExp(${JSON.stringify(KEY_VALUE.source)}, "g");
const PLACEHOLDER = new RegExp(${JSON.stringify(PLACEHOLDER.source)}, "i");

const args = process.argv.slice(2);
const code = args.find((a) => !a.startsWith("--"));
const yes = args.includes("--yes");
const list = args.includes("--list");
if (!code && !list) {
  console.error("Usage: node connect.js <pairing-code> [--yes] [--list]");
  process.exit(1);
}

const home = os.homedir();
const paths = FILES.map((f) => f.replace(/^~/, home)).concat(
  path.join(process.env.XDG_DATA_HOME || path.join(home, ".local", "share"), "opencode", "auth.json"),
);
const byEnvKey = new Map(PROVIDERS.map((p) => [p.envKey, p.id]));
for (const [k, v] of Object.entries(ENV_ALIASES)) byEnvKey.set(k, v);
const label = (id) => (PROVIDERS.find((p) => p.id === id) || { label: id }).label;
const mask = (k) => k.slice(0, 3) + "\\u2022".repeat(Math.min(k.length - 6, 20)) + k.slice(-3);
const tilde = (p) => p.replace(home, "~");

const found = [];
const seen = new Set();
const push = (providerId, source, apiKey) => {
  if (PLACEHOLDER.test(apiKey)) return;
  const k = providerId + "|" + source;
  if (seen.has(k)) return;
  seen.add(k);
  found.push({ providerId, source, apiKey });
};
for (const p of paths) {
  let text;
  try { text = fs.readFileSync(p, "utf8"); } catch { continue; }
  const source = tilde(p);
  if (p.endsWith(path.join("opencode", "auth.json"))) {
    try {
      for (const [name, e] of Object.entries(JSON.parse(text))) {
        const id = OPENCODE_IDS[name];
        if (id && e && e.type === "api" && typeof e.key === "string" && e.key.length >= 20) push(id, source, e.key);
      }
    } catch {}
    continue;
  }
  for (const m of text.matchAll(KEY_VALUE)) {
    const id = byEnvKey.get(m[1]);
    if (id) push(id, source, m[2]);
  }
}

if (found.length === 0) {
  console.log("No API keys found. Looked in:\\n  " + paths.map(tilde).join("\\n  "));
  console.log("\\nNote: subscription logins (Claude Code, Codex/ChatGPT, Gemini CLI, OpenCode OAuth) only work inside the tool that created them and are never picked up. Only API keys are.");
  process.exit(0);
}
console.log("Found " + found.length + " API key(s):");
for (const f of found) console.log("  " + label(f.providerId).padEnd(14) + " " + mask(f.apiKey).padEnd(28) + " " + f.source);
if (list) process.exit(0);

(async () => {
  let approved = found;
  if (!yes) {
    // When piped in via curl, stdin is the script itself; prompt on the terminal.
    let input = process.stdin;
    if (!input.isTTY) {
      input = fs.createReadStream("/dev/tty");
      input.on("error", () => {
        console.error("No terminal available for prompts. Re-run with --yes to import everything listed above, or save this script to a file and run it directly.");
        process.exit(1);
      });
    }
    const rl = readline.createInterface({ input, output: process.stdout });
    const ask = (q) => new Promise((r) => rl.question(q, r));
    approved = [];
    for (const f of found) {
      const a = (await ask("Import " + label(f.providerId) + " key from " + f.source + "? [y/N] ")).trim().toLowerCase();
      if (a === "y" || a === "yes") approved.push(f);
    }
    rl.close();
  }
  if (approved.length === 0) { console.log("Nothing imported."); return; }
  const res = await fetch(APP + "/api/providers/pair/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, items: approved.map(({ providerId, apiKey }) => ({ providerId, apiKey })) }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { console.error("Failed: " + (body.error || ("HTTP " + res.status))); process.exit(1); }
  console.log("Imported into DevChat: " + (body.imported || []).join(", ") + "\\nGo back to the browser; Settings will pick them up.");
})().catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
`;
}
