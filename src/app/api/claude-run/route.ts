import { spawn } from "child_process";
import { requireUserId } from "@/lib/auth";
import { isRunnableCwd } from "@/lib/claude/sessions";

// Spawning a CLI needs the Node runtime and a long-lived connection.
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Headless runs can't prompt, so this holds for the whole run. `plan` is
 * read-only and the default; bypassPermissions is deliberately not offered.
 */
const ALLOWED_PERMISSION_MODES = ["plan", "acceptEdits", "dontAsk"] as const;
type PermissionMode = (typeof ALLOWED_PERMISSION_MODES)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Next puts .env into process.env, so the app's ANTHROPIC_API_KEY would leak
 * into the CLI and override the user's claude.ai login ("Invalid API key").
 */
const INHERITED_AUTH_VARS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_API_URL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
];

/** Start the dev server from inside Claude Code and these leak in, making the
 *  spawned run think it's a nested child instead of a fresh session. */
function isSessionVar(key: string): boolean {
  return (
    key === "CLAUDECODE" ||
    key === "CLAUDE_PID" ||
    key.startsWith("CLAUDE_CODE_") ||
    key.startsWith("CLAUDE_AGENT_")
  );
}

function cliEnv(): NodeJS.ProcessEnv {
  // Copy-then-delete keeps ProcessEnv's required members (NODE_ENV).
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (INHERITED_AUTH_VARS.includes(key) || isSessionVar(key)) delete env[key];
  }
  return env;
}

function bad(error: string, status = 400) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: Request) {
  await requireUserId();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body");
  }

  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const cwd = typeof body?.cwd === "string" ? body.cwd : "";
  const permissionMode: PermissionMode = ALLOWED_PERMISSION_MODES.includes(body?.permissionMode)
    ? body.permissionMode
    : "plan";
  const resumeSessionId =
    typeof body?.resumeSessionId === "string" ? body.resumeSessionId.trim() : "";
  const model = typeof body?.model === "string" ? body.model.trim() : "";

  if (!prompt) return bad("prompt is required");
  if (!cwd) return bad("cwd is required");

  // Confined to known project dirs so a crafted path can't run somewhere odd.
  if (!(await isRunnableCwd(cwd))) {
    return bad("cwd is not one of the known Claude Code project directories", 403);
  }
  if (resumeSessionId && !UUID_RE.test(resumeSessionId)) {
    return bad("resumeSessionId must be a session UUID");
  }
  // Guard against a model string being read as another flag.
  if (model && !/^[A-Za-z0-9._:\-]+$/.test(model)) {
    return bad("model contains unsupported characters");
  }

  const args = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    // stream-json needs --verbose to emit per-message events.
    "--verbose",
    "--permission-mode",
    permissionMode,
  ];
  if (resumeSessionId) args.push("--resume", resumeSessionId);
  if (model) args.push("--model", model);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {}
      };

      send({ type: "vas-start", cwd, permissionMode, resumeSessionId: resumeSessionId || null });

      // `prompt` is passed as an argv entry, never through a shell, so no
      // quoting or injection concerns.
      const child = spawn("claude", args, {
        cwd,
        env: cliEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });

      // The CLI emits newline-delimited JSON; forward each complete line and
      // buffer any partial trailing one.
      let stdoutBuf = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBuf += chunk.toString();
        const lines = stdoutBuf.split("\n");
        stdoutBuf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            send(JSON.parse(trimmed));
          } catch {
            send({ type: "vas-stdout", text: trimmed });
          }
        }
      });

      let stderrBuf = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBuf += chunk.toString();
        if (stderrBuf.length > 8000) stderrBuf = stderrBuf.slice(-8000);
      });

      child.on("error", (err: any) => {
        send({
          type: "vas-error",
          message:
            err?.code === "ENOENT"
              ? "The `claude` CLI was not found on PATH for the server process."
              : err?.message || String(err),
        });
        close();
      });

      child.on("close", (code) => {
        if (stdoutBuf.trim()) {
          try {
            send(JSON.parse(stdoutBuf.trim()));
          } catch {
            send({ type: "vas-stdout", text: stdoutBuf.trim() });
          }
        }
        if (code !== 0) {
          send({ type: "vas-error", message: stderrBuf.trim() || `claude exited with code ${code}` });
        }
        send({ type: "vas-done", exitCode: code });
        close();
      });

      // Client disconnected or pressed Stop — don't leave the agent running.
      req.signal.addEventListener("abort", () => {
        try {
          child.kill("SIGTERM");
        } catch {}
        send({ type: "vas-done", exitCode: null, stopped: true });
        close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
