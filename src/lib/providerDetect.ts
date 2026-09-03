import { readFile, stat } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { PROVIDERS, ENV_ALIASES } from "./providers";
export { ENV_ALIASES };
import { findCliBins } from "./cliProviders";

/**
 * Finds provider API keys that other tools on this machine already store, so
 * a local DevChat can offer to reuse them (bb-style "pick up your existing
 * credentials"). Only runs on the user's own machine — see detectionAvailable().
 *
 * Deliberately limited to API keys the user typed into those tools. OAuth
 * tokens (Claude Code's ~/.claude/.credentials.json, Codex's `tokens`, Gemini
 * CLI's oauth_creds.json) are never read: their terms restrict them to the
 * tool that issued them.
 */
export interface DetectedCredential {
  providerId: string;
  /** File it came from, with the home directory shown as `~`. */
  source: string;
  apiKey: string;
}

// The data and patterns below are also injected into the pairing script that
// runs on a user's machine when DevChat is hosted (see providerPair.ts), so
// both scanners stay in sync. That script mirrors extractCredentials().

// OpenCode's auth.json is keyed by its own provider ids.
export const OPENCODE_IDS: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  openrouter: "openrouter",
  nvidia: "nvidia-nim",
};

export const SCAN_FILES = [
  "~/.codex/auth.json", // Codex CLI, API-key login (OAuth `tokens` ignored)
  "~/.claude/settings.json", // Claude Code `env` block
  "~/.gemini/.env", // Gemini CLI
  "~/.bb/env.json", // bb
  "~/.zshrc",
  "~/.zprofile",
  "~/.zshenv",
  "~/.bashrc",
  "~/.bash_profile",
  "~/.profile",
  "~/.config/fish/config.fish",
];

// `OPENAI_API_KEY=sk-…`, `"OPENAI_API_KEY": "sk-…"`, `export X=…`, `set -gx X …`.
// ponytail: one regex over every file instead of per-format parsers; add a
// parser only for a format this misses (OpenCode's JSON below is the one so far).
export const KEY_VALUE = /["']?\b([A-Z][A-Z0-9_]*_API_KEY)["']?(?:\s*[=:]\s*|\s+)["']?([A-Za-z0-9_\-.]{20,})/g;
export const PLACEHOLDER = /your|xxx|placeholder|example|changeme|redacted/i;

/** Pure parser, separated from the filesystem so it can be unit-tested. */
export function extractCredentials(
  files: Array<{ source: string; text: string }>,
): DetectedCredential[] {
  const byEnvKey = new Map(PROVIDERS.map((p) => [p.envKey, p.id] as const));
  for (const [alias, id] of Object.entries(ENV_ALIASES)) byEnvKey.set(alias, id);

  const out: DetectedCredential[] = [];
  const seen = new Set<string>();
  const push = (providerId: string, source: string, apiKey: string) => {
    if (PLACEHOLDER.test(apiKey)) return;
    const k = `${providerId}|${source}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ providerId, source, apiKey });
  };

  for (const { source, text } of files) {
    if (source.endsWith("opencode/auth.json")) {
      try {
        const json = JSON.parse(text) as Record<string, { type?: string; key?: string }>;
        for (const [name, entry] of Object.entries(json)) {
          const id = OPENCODE_IDS[name];
          if (id && entry?.type === "api" && typeof entry.key === "string" && entry.key.length >= 20) {
            push(id, source, entry.key);
          }
        }
      } catch {
        // not JSON — ignore
      }
      continue;
    }
    for (const m of text.matchAll(KEY_VALUE)) {
      const id = byEnvKey.get(m[1]);
      if (id) push(id, source, m[2]);
    }
  }
  return out;
}

/**
 * Scanning reads the server's home directory, so it must only run when the
 * server IS the user's machine. `next dev` is the documented local path; a
 * local production build can opt in. Never on Vercel or any shared host,
 * where it would expose the host operator's files to every signed-in user.
 */
export function detectionAvailable(): boolean {
  if (process.env.VERCEL) return false;
  return process.env.NODE_ENV === "development" || process.env.ALLOW_PROVIDER_DETECTION === "1";
}

/**
 * Per-tool explanation of the scan, so "nothing found" tells the user why:
 * most coding tools sign in with a subscription (OAuth) that no other app is
 * allowed to reuse, and that is not the same as having an API key.
 */
export interface ToolReport {
  tool: string;
  status: "keys" | "oauth" | "none" | "absent";
  detail: string;
}

const SHELL_FILES = SCAN_FILES.filter((f) => !/\.(codex|claude|gemini|bb)\//.test(f));

// Paths whose existence tells us a tool is installed / how it is signed in.
export const PROBE_PATHS = [
  "~/.claude",
  "~/.claude/.credentials.json",
  "~/.codex/auth.json",
  "~/.gemini",
  "~/.gemini/oauth_creds.json",
  "~/.bb",
  "~/.opencode",
  "~/.config/opencode",
  "~/.local/share/opencode",
  ...SHELL_FILES,
];

/** Pure; `exists` and `files` use `~`-relative paths. `opencodeAuth` is the auth.json source path. */
export function describeTools(
  exists: (path: string) => boolean,
  files: Array<{ source: string; text: string }>,
  candidates: DetectedCredential[],
  opencodeAuth = "~/.local/share/opencode/auth.json",
  /** Ids of CLI providers (cliProviders.ts) whose command is installed. */
  cli: Set<string> = new Set(),
): ToolReport[] {
  const has = (src: string) => candidates.some((c) => c.source === src);
  const text = (src: string) => files.find((f) => f.source === src)?.text ?? "";
  const out: ToolReport[] = [];

  if (exists("~/.claude")) {
    out.push(
      has("~/.claude/settings.json")
        ? { tool: "Claude Code", status: "keys", detail: "API key found in ~/.claude/settings.json." }
        : {
            tool: "Claude Code",
            status: "oauth",
            detail: cli.has("claude-code")
              ? "Signed in with a Claude subscription. DevChat can use it anyway: pick a Claude Code model in the model selector and DevChat runs the claude command for you. (A raw API key would also work: console.anthropic.com/settings/keys.)"
              : "Signed in with a Claude subscription. That login only works inside Claude Code and can't be reused here. To use Anthropic in DevChat, create an API key at console.anthropic.com/settings/keys.",
          },
    );
  } else out.push({ tool: "Claude Code", status: "absent", detail: "Not installed." });

  if (exists("~/.codex/auth.json")) {
    out.push(
      has("~/.codex/auth.json")
        ? { tool: "Codex CLI", status: "keys", detail: "API key found in ~/.codex/auth.json." }
        : /"tokens"/.test(text("~/.codex/auth.json"))
          ? {
              tool: "Codex CLI",
              status: "oauth",
              detail: cli.has("codex")
                ? "Signed in with ChatGPT. DevChat can use it anyway: pick the Codex model in the model selector and DevChat runs the codex command for you."
                : "Signed in with ChatGPT. That login only works inside Codex, and the codex command isn't installed here. To use OpenAI in DevChat, create an API key at platform.openai.com/api-keys.",
            }
          : { tool: "Codex CLI", status: "none", detail: "Installed, but no API key is saved." },
    );
  } else out.push({ tool: "Codex CLI", status: "absent", detail: "Not installed." });

  if (exists("~/.opencode") || exists("~/.config/opencode") || exists("~/.local/share/opencode")) {
    out.push(
      has(opencodeAuth)
        ? { tool: "OpenCode", status: "keys", detail: `API key found in ${opencodeAuth}.` }
        : /"type"\s*:\s*"oauth"/.test(text(opencodeAuth))
          ? {
              tool: "OpenCode",
              status: "oauth",
              detail:
                "Signed in with a subscription login (OAuth). That login only works inside OpenCode. Add the provider to OpenCode with an API key, or paste the key above.",
            }
          : {
              tool: "OpenCode",
              status: "none",
              detail: cli.has("opencode")
                ? "No provider API key is saved, but the opencode command is installed, so every model OpenCode lists is available in the model selector; DevChat runs OpenCode for you."
                : "Installed, but no provider API key is saved (opencode auth login was never run with a key). If it works through environment variables, export them in ~/.zshrc or ~/.zprofile and scan again.",
            },
    );
  } else out.push({ tool: "OpenCode", status: "absent", detail: "Not installed." });

  if (exists("~/.gemini")) {
    out.push(
      has("~/.gemini/.env")
        ? { tool: "Gemini CLI", status: "keys", detail: "API key found in ~/.gemini/.env." }
        : exists("~/.gemini/oauth_creds.json")
          ? {
              tool: "Gemini CLI",
              status: "oauth",
              detail:
                "Signed in with Google. That login only works inside Gemini CLI. To use Gemini in DevChat, create a key at aistudio.google.com/apikey.",
            }
          : { tool: "Gemini CLI", status: "none", detail: "Installed, but no API key is saved in ~/.gemini/.env." },
    );
  } else out.push({ tool: "Gemini CLI", status: "absent", detail: "Not installed." });

  if (exists("~/.bb")) {
    out.push(
      has("~/.bb/env.json")
        ? { tool: "bb", status: "keys", detail: "API key found in ~/.bb/env.json." }
        : { tool: "bb", status: "none", detail: "Installed, but no provider API keys are stored in ~/.bb/env.json." },
    );
  } else out.push({ tool: "bb", status: "absent", detail: "Not installed." });

  const shells = SHELL_FILES.filter(exists);
  out.push(
    shells.length === 0
      ? { tool: "Shell profiles", status: "absent", detail: "No shell profile files found." }
      : shells.some(has)
        ? { tool: "Shell profiles", status: "keys", detail: `API key exports found in ${shells.filter(has).join(", ")}.` }
        : {
            tool: "Shell profiles",
            status: "none",
            detail: `Checked ${shells.join(", ")}; no *_API_KEY exports. Keys set only for the current terminal session, or loaded by a secrets manager, aren't visible here.`,
          },
  );

  return out;
}

export async function scanLocalCredentials(): Promise<{
  candidates: DetectedCredential[];
  report: ToolReport[];
}> {
  const home = homedir();
  const tilde = (p: string) => p.replace(home, "~");
  const opencodeAuth = join(
    process.env.XDG_DATA_HOME || join(home, ".local", "share"),
    "opencode",
    "auth.json",
  );
  const paths = [...SCAN_FILES.map((f) => f.replace(/^~/, home)), opencodeAuth];
  const files = (
    await Promise.all(
      paths.map(async (p) => {
        try {
          return { source: tilde(p), text: await readFile(p, "utf8") };
        } catch {
          return null;
        }
      }),
    )
  ).filter((f): f is { source: string; text: string } => f !== null);

  const present = new Set<string>();
  await Promise.all(
    PROBE_PATHS.map(async (p) => {
      try {
        await stat(p.replace(/^~/, home));
        present.add(p);
      } catch {
        // absent
      }
    }),
  );
  for (const f of files) present.add(f.source);

  const candidates = extractCredentials(files);
  const cli = await findCliBins();
  const report = describeTools((p) => present.has(p), files, candidates, tilde(opencodeAuth), cli);
  return { candidates, report };
}
