"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Play,
  Square,
  FolderOpen,
  History,
  AlertTriangle,
  Loader2,
  RotateCcw,
  Terminal,
} from "lucide-react";

interface ClaudeProject {
  slug: string;
  cwd: string;
  sessionCount: number;
  lastActive: string | null;
}

interface ClaudeSession {
  id: string;
  projectSlug: string;
  cwd: string | null;
  title: string | null;
  gitBranch: string | null;
  lastPrompt: string | null;
  userMessages: number;
  assistantMessages: number;
  modified: string;
  sizeBytes: number;
}

type PermissionMode = "plan" | "acceptEdits" | "dontAsk";

const MODES: { id: PermissionMode; label: string; blurb: string }[] = [
  { id: "plan", label: "Plan", blurb: "Read-only. Investigates and proposes, never writes." },
  { id: "acceptEdits", label: "Accept edits", blurb: "Can edit files in this folder without asking." },
  { id: "dontAsk", label: "Don't ask", blurb: "Can edit files and run bash commands without asking." },
];

interface LogLine {
  kind: "info" | "text" | "tool" | "result" | "error";
  text: string;
}

function shortPath(p: string): string {
  const home = "/Users/";
  if (!p.startsWith(home)) return p;
  const rest = p.slice(home.length);
  const slash = rest.indexOf("/");
  return slash === -1 ? "~" : "~" + rest.slice(slash);
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** Turn one stream-json event from the CLI into displayable lines. */
function eventToLines(ev: any): LogLine[] {
  const out: LogLine[] = [];
  switch (ev?.type) {
    case "vas-start":
      out.push({
        kind: "info",
        text: `Running in ${shortPath(ev.cwd)} · ${ev.permissionMode}${ev.resumeSessionId ? ` · resuming ${String(ev.resumeSessionId).slice(0, 8)}` : ""}`,
      });
      break;
    case "system":
      if (ev.subtype === "init") {
        out.push({ kind: "info", text: `Session ${String(ev.session_id || "").slice(0, 8)} started` });
      }
      break;
    case "assistant": {
      for (const block of ev?.message?.content ?? []) {
        if (block?.type === "text" && block.text?.trim()) {
          out.push({ kind: "text", text: block.text.trim() });
        } else if (block?.type === "tool_use") {
          const arg =
            block.input?.file_path || block.input?.command || block.input?.pattern || "";
          out.push({ kind: "tool", text: `${block.name}${arg ? `  ${String(arg).slice(0, 120)}` : ""}` });
        }
      }
      break;
    }
    case "result":
      out.push({
        kind: ev.subtype === "success" ? "result" : "error",
        text:
          (ev.result ? String(ev.result) : `Finished (${ev.subtype})`) +
          (ev.num_turns ? `\n\n— ${ev.num_turns} turn${ev.num_turns === 1 ? "" : "s"}` : ""),
      });
      break;
    case "vas-error":
      out.push({ kind: "error", text: ev.message || "Run failed" });
      break;
    case "vas-stdout":
      out.push({ kind: "info", text: ev.text });
      break;
    case "vas-done":
      if (ev.stopped) out.push({ kind: "info", text: "Stopped." });
      break;
  }
  return out;
}

export default function ClaudeRunner() {
  const [projects, setProjects] = useState<ClaudeProject[]>([]);
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);

  const [prompt, setPrompt] = useState("");
  const [cwd, setCwd] = useState("");
  const [mode, setMode] = useState<PermissionMode>("plan");
  const [resumeId, setResumeId] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const loadMeta = useCallback(async () => {
    try {
      const res = await fetch("/api/claude-system/sessions?limit=40");
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setProjects(data.projects ?? []);
      setSessions(data.sessions ?? []);
      setCwd((prev) => prev || data.projects?.[0]?.cwd || "");
    } catch {
      setProjects([]);
    } finally {
      setLoadingMeta(false);
    }
  }, []);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [log]);

  const append = useCallback((lines: LogLine[]) => {
    if (lines.length) setLog((prev) => [...prev, ...lines]);
  }, []);

  async function run() {
    if (!prompt.trim() || !cwd || running) return;
    setRunning(true);
    setLog([]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/claude-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          cwd,
          permissionMode: mode,
          resumeSessionId: resumeId || undefined,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        let msg = "Failed to start run";
        try {
          msg = (await res.json())?.error || msg;
        } catch {}
        append([{ kind: "error", text: msg }]);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          try {
            append(eventToLines(JSON.parse(t)));
          } catch {}
        }
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        append([{ kind: "error", text: e?.message || String(e) }]);
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
      loadMeta();
    }
  }

  function stop() {
    abortRef.current?.abort();
    setRunning(false);
  }

  const activeMode = MODES.find((m) => m.id === mode)!;

  return (
    <div className="glass-card rounded-[var(--glass-radius-xl)] p-6 space-y-5">
      <div className="flex items-center gap-2">
        <Terminal size={18} className="text-green-400" />
        <h2 className="text-lg font-semibold text-[var(--foreground)]">Run Claude Code</h2>
      </div>

      {!loadingMeta && projects.length === 0 && (
        <div className="text-sm text-zinc-400">
          No Claude Code projects found under <code>~/.claude/projects</code>.
        </div>
      )}

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={running}
        rows={3}
        placeholder="What should Claude Code do in this folder?"
        className="w-full resize-y glass-surface rounded-[var(--glass-radius-md)] px-3 py-2 text-sm text-[var(--foreground)] outline-none placeholder:text-zinc-500 disabled:opacity-50"
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs text-zinc-400 flex items-center gap-1.5 mb-1">
            <FolderOpen size={12} /> Folder
          </span>
          <select
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            disabled={running}
            className="w-full glass-surface rounded-[var(--glass-radius-md)] px-3 py-2 text-sm text-[var(--foreground)] outline-none disabled:opacity-50"
          >
            {projects.map((p) => (
              <option key={p.slug} value={p.cwd}>
                {shortPath(p.cwd)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs text-zinc-400 mb-1 block">Permissions</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as PermissionMode)}
            disabled={running}
            className="w-full glass-surface rounded-[var(--glass-radius-md)] px-3 py-2 text-sm text-[var(--foreground)] outline-none disabled:opacity-50"
          >
            {MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p
        className={`text-xs flex items-start gap-1.5 ${
          mode === "plan" ? "text-zinc-500" : "text-amber-400"
        }`}
      >
        {mode !== "plan" && <AlertTriangle size={13} className="mt-0.5 shrink-0" />}
        <span>
          {activeMode.blurb}
          {mode !== "plan" && " A run happens with no confirmation prompts."}
        </span>
      </p>

      {resumeId && (
        <div className="flex items-center gap-2 text-xs text-blue-300">
          <RotateCcw size={12} />
          Resuming session {resumeId.slice(0, 8)}
          <button
            onClick={() => setResumeId(null)}
            className="ml-1 underline hover:text-blue-200"
          >
            start fresh instead
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        {running ? (
          <button
            onClick={stop}
            className="flex items-center gap-2 glass-button-danger rounded-[var(--glass-radius-md)] px-4 py-2 text-sm font-medium text-red-200"
          >
            <Square size={14} /> Stop
          </button>
        ) : (
          <button
            onClick={run}
            disabled={!prompt.trim() || !cwd}
            className="flex items-center gap-2 glass-button-primary rounded-[var(--glass-radius-md)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play size={14} /> Run
          </button>
        )}
        {running && (
          <span className="flex items-center gap-1.5 text-xs text-zinc-400">
            <Loader2 size={12} className="animate-spin" /> working…
          </span>
        )}
      </div>

      {log.length > 0 && (
        <div className="max-h-96 overflow-y-auto space-y-2 border-t border-[var(--glass-border)] pt-4">
          {log.map((line, i) => (
            <div
              key={i}
              className={`text-sm whitespace-pre-wrap break-words rounded-[var(--glass-radius-sm)] px-3 py-2 ${
                line.kind === "error"
                  ? "bg-red-950/40 text-red-300"
                  : line.kind === "tool"
                    ? "bg-[var(--glass-bg)] text-blue-300 font-mono text-xs"
                    : line.kind === "info"
                      ? "text-zinc-500 text-xs"
                      : line.kind === "result"
                        ? "bg-green-950/30 text-green-200"
                        : "text-[var(--foreground)]"
              }`}
            >
              {line.text}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}

      <div className="border-t border-[var(--glass-border)] pt-4">
        <div className="flex items-center gap-2 mb-3">
          <History size={14} className="text-zinc-400" />
          <h3 className="text-sm font-medium text-[var(--foreground)]">Recent sessions</h3>
          <span className="text-xs text-zinc-500">({sessions.length})</span>
        </div>
        <div className="max-h-72 overflow-y-auto space-y-1">
          {sessions.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-3 px-3 py-2 rounded-[var(--glass-radius-sm)] hover:bg-[var(--glass-bg-hover)]"
            >
              <div className="min-w-0">
                <div className="text-sm text-[var(--foreground)] truncate">
                  {s.title || s.lastPrompt || "(untitled)"}
                </div>
                <div className="text-[11px] text-zinc-500 truncate">
                  {s.cwd ? shortPath(s.cwd) : "?"}
                  {s.gitBranch ? ` · ${s.gitBranch}` : ""} · {s.userMessages}↑ {s.assistantMessages}↓ ·{" "}
                  {relTime(s.modified)}
                </div>
              </div>
              <button
                disabled={running || !s.cwd}
                onClick={() => {
                  setResumeId(s.id);
                  if (s.cwd) setCwd(s.cwd);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="shrink-0 flex items-center gap-1.5 glass-button rounded-[var(--glass-radius-sm)] px-2.5 py-1 text-xs text-[var(--foreground)] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RotateCcw size={11} /> Resume
              </button>
            </div>
          ))}
          {!loadingMeta && sessions.length === 0 && (
            <div className="text-sm text-zinc-500">No sessions yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
