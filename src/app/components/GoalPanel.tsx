"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Target,
  Play,
  Square,
  CheckCircle2,
  Circle,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import SidePanel from "./ui/SidePanel";

interface GoalPanelProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId: string;
  model?: string;
  onComplete?: () => void;
  kickoff?: { objective: string; nonce: number };
}

interface Task {
  id: string;
  text: string;
  status: string;
  note?: string;
}

interface LogEntry {
  cycle: number;
  text: string;
  toolNames: string[];
}

const STATUS_LABEL: Record<string, string> = {
  planning: "Planning…",
  running: "Running",
  done: "Completed",
  stopped: "Stopped",
  exhausted: "Out of budget",
  failed: "Failed",
};

export default function GoalPanel({
  isOpen,
  onClose,
  conversationId,
  model,
  onComplete,
  kickoff,
}: GoalPanelProps) {
  const [objective, setObjective] = useState("");
  const [maxCycles, setMaxCycles] = useState(10);
  const [tokenBudget, setTokenBudget] = useState(120_000);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<string>("idle");
  const [running, setRunning] = useState(false);
  const [cyclesUsed, setCyclesUsed] = useState(0);
  const [tokensUsed, setTokensUsed] = useState(0);
  const [budget, setBudget] = useState(120_000);
  const [summary, setSummary] = useState<string>("");
  const [runId, setRunId] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const abortRef = useRef<AbortController | null>(null);

  const live = status === "planning" || status === "running";

  useEffect(() => {
    if (!isOpen || running) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/goal?conversationId=${conversationId}`);
        const { run } = await res.json();
        if (cancelled || !run) return;
        setObjective((o) => o || run.objective);
        setTasks(run.tasks || []);
        setStatus(run.status);
        setCyclesUsed(run.cyclesUsed);
        setTokensUsed(run.tokensUsed);
        setBudget(run.tokenBudget);
        setSummary(run.summary || "");
        setMaxCycles(run.maxCycles);
        setRunId(run.id);
        setUpdatedAt(run.updatedAt);
      } catch {
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, conversationId, running]);

  const updateTask = useCallback((id: string, patch: Partial<Task>) => {
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx === -1) {
        if (patch.text !== undefined || patch.status === "pending") {
          return [...prev, { id, text: patch.text || "", status: patch.status || "pending", note: patch.note }];
        }
        return prev;
      }
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }, []);

  async function start(objOverride?: string) {
    const obj = (objOverride ?? objective).trim();
    if (!obj || running) return;
    if (objOverride !== undefined) setObjective(objOverride);
    setRunning(true);
    setStatus("planning");
    setTasks([]);
    setLog([]);
    setSummary("");
    setCyclesUsed(0);
    setTokensUsed(0);
    setRunId(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/goal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, objective: obj, model, maxCycles, tokenBudget }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error("Failed to start goal");
      setBudget(tokenBudget);
      const headerRunId = res.headers.get("X-Goal-Run-Id");
      if (headerRunId) setRunId(headerRunId);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let ev: any;
          try {
            ev = JSON.parse(trimmed);
          } catch {
            continue;
          }
          handleEvent(ev);
        }
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        setStatus("failed");
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
      onComplete?.();
    }
  }

  function handleEvent(ev: any) {
    switch (ev.type) {
      case "plan":
        setTasks(ev.tasks.map((t: any) => ({ ...t, status: "pending" })));
        setStatus("running");
        break;
      case "task":
        updateTask(ev.id, { status: ev.status, note: ev.note });
        break;
      case "cycle":
        break;
      case "thought":
        setLog((prev) => [...prev, { cycle: ev.cycle, text: ev.text, toolNames: ev.toolNames || [] }]);
        break;
      case "status":
        setStatus(ev.status);
        setCyclesUsed(ev.cyclesUsed);
        setTokensUsed(ev.tokensUsed);
        if (ev.tokenBudget) setBudget(ev.tokenBudget);
        if (ev.runId) setRunId(ev.runId);
        break;
      case "done":
        setStatus(ev.status);
        setSummary(ev.summary || "");
        break;
      case "error":
        setStatus("failed");
        setLog((prev) => [...prev, { cycle: -1, text: `Error: ${ev.message}`, toolNames: [] }]);
        break;
    }
  }

  async function stop() {
    abortRef.current?.abort();
    setStatus("stopped");
    setRunning(false);
    if (runId) {
      try {
        await fetch("/api/goal", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId }),
        });
      } catch {
      }
    }
  }

  useEffect(() => {
    if (!isOpen || running || !live) return;
    const iv = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [isOpen, running, live]);

  useEffect(() => {
    if (!isOpen || running || !live) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/goal?conversationId=${conversationId}`);
        const { run } = await res.json();
        if (cancelled || !run) return;
        setRunId(run.id);
        setStatus(run.status);
        setTasks(run.tasks || []);
        setCyclesUsed(run.cyclesUsed);
        setTokensUsed(run.tokensUsed);
        setBudget(run.tokenBudget);
        setUpdatedAt(run.updatedAt);
        if (run.summary) setSummary(run.summary);
      } catch {
      }
    };
    poll();
    const iv = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [isOpen, running, live, conversationId]);

  const startRef = useRef(start);
  startRef.current = start;
  const lastKickoffRef = useRef(0);
  useEffect(() => {
    if (!kickoff || kickoff.nonce === lastKickoffRef.current) return;
    lastKickoffRef.current = kickoff.nonce;
    if (kickoff.objective.trim()) startRef.current(kickoff.objective);
  }, [kickoff]);

  const doneCount = tasks.filter((t) => t.status === "done").length;
  const pct = budget > 0 ? Math.min(100, Math.round((tokensUsed / budget) * 100)) : 0;
  const terminal = ["done", "stopped", "exhausted", "failed"].includes(status);
  const watching = !running && live;
  const ageSec = updatedAt
    ? Math.max(0, Math.round((nowMs - new Date(updatedAt).getTime()) / 1000))
    : null;
  const stale = watching && ageSec !== null && ageSec > 150;

  return (
    <SidePanel
      isOpen={isOpen}
      onClose={onClose}
      title="Goal Mode"
      subtitle="Give an objective; VAS plans and works autonomously until done."
      widthClass="max-w-lg"
      footer={
        running || live ? (
          <button
            onClick={stop}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 hover:bg-red-500 px-4 py-2.5 text-sm font-medium text-white transition"
          >
            <Square size={15} /> {stale ? "Clear stuck run" : "Stop run"}
          </button>
        ) : (
          <button
            onClick={() => start()}
            disabled={!objective.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-medium text-white transition"
          >
            <Play size={15} /> {tasks.length > 0 ? "Start new run" : "Start goal"}
          </button>
        )
      }
    >
      {/* Objective input */}
      <div>
        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
          <Target size={13} /> Objective
        </label>
        <textarea
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          disabled={running}
          placeholder="e.g. Research the top 3 open-source vector DBs, compare them on speed, license, and ecosystem, and write a recommendation."
          className="w-full min-h-[88px] glass-input rounded-[var(--glass-radius-md)] px-3 py-2.5 text-sm resize-y disabled:opacity-60"
        />
        <div className="mt-2 flex gap-3">
          <label className="flex flex-1 flex-col gap-1 text-[11px] text-zinc-500">
            Max cycles
            <input
              type="number"
              min={1}
              max={25}
              value={maxCycles}
              disabled={running}
              onChange={(e) => setMaxCycles(Number(e.target.value))}
              className="rounded glass-input px-2 py-1 text-sm disabled:opacity-60"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-[11px] text-zinc-500">
            Token budget
            <input
              type="number"
              min={10000}
              step={10000}
              value={tokenBudget}
              disabled={running}
              onChange={(e) => setTokenBudget(Number(e.target.value))}
              className="rounded glass-input px-2 py-1 text-sm disabled:opacity-60"
            />
          </label>
        </div>
      </div>

      {/* Status bar */}
      {status !== "idle" && (
        <div className="glass-card rounded-[var(--glass-radius-md)] p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-medium text-zinc-200">
              {live && !stale && <Loader2 size={13} className="animate-spin" />}
              {status === "done" && <CheckCircle2 size={13} className="text-emerald-400" />}
              {(status === "failed" || status === "exhausted" || stale) && (
                <AlertTriangle size={13} className="text-amber-400" />
              )}
              {STATUS_LABEL[status] ?? status}
            </span>
            <span className="text-zinc-500">
              {doneCount}/{tasks.length} steps · cycle {cyclesUsed}
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full glass">
            <div
              className={`h-full rounded-full transition-all ${pct > 90 ? "bg-amber-500" : "bg-emerald-500"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-zinc-500">
            <span>
              {tokensUsed.toLocaleString()} / {budget.toLocaleString()} tokens ({pct}%)
            </span>
            {watching && ageSec !== null && (
              <span className={stale ? "text-amber-400" : "text-zinc-500"}>
                {ageSec < 60 ? `active ${ageSec}s ago` : `idle ${Math.floor(ageSec / 60)}m`}
              </span>
            )}
          </div>
          {watching && !stale && (
            <p className="mt-2 text-[11px] text-zinc-500">
              Running on the server — watching progress live. You can leave this panel; it keeps going.
            </p>
          )}
          {stale && (
            <p className="mt-2 text-[11px] text-amber-400/90">
              No recent activity — this run likely stopped when the page was
              refreshed or the connection dropped. Press "Clear stuck run" to reset it.
            </p>
          )}
        </div>
      )}

      {/* Checklist */}
      {tasks.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Plan
          </h3>
          <ul className="space-y-1.5">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 shrink-0">
                  {t.status === "done" ? (
                    <CheckCircle2 size={15} className="text-emerald-400" />
                  ) : t.status === "active" ? (
                    <Loader2 size={15} className="animate-spin text-blue-400" />
                  ) : t.status === "blocked" ? (
                    <AlertTriangle size={15} className="text-amber-400" />
                  ) : (
                    <Circle size={15} className="text-zinc-600" />
                  )}
                </span>
                <div className="min-w-0">
                  <span className={t.status === "done" ? "text-zinc-400 line-through" : "text-zinc-200"}>
                    {t.text}
                  </span>
                  {t.note && (
                    <div className="text-[11px] text-zinc-500">{t.note}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Activity log */}
      {log.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Activity
          </h3>
          <div className="space-y-2">
            {log.map((entry, i) => (
              <div key={i} className="glass-card rounded-[var(--glass-radius-md)] p-2.5 text-xs">
                <div className="mb-1 flex items-center gap-2 text-[10px] text-zinc-500">
                  {entry.cycle > 0 && <span>Cycle {entry.cycle}</span>}
                  {entry.toolNames.map((n, j) => (
                    <span key={j} className="rounded glass px-1.5 py-0.5 text-zinc-400">
                      {n}
                    </span>
                  ))}
                </div>
                <p className="whitespace-pre-wrap text-zinc-300">{entry.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Final summary */}
      {summary && terminal && (
        <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-3">
          <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-emerald-400">
            Result
          </h3>
          <p className="whitespace-pre-wrap text-sm text-zinc-200">{summary}</p>
          <p className="mt-2 text-[11px] text-zinc-500">
            Added to the conversation. Memory was consolidated from this run.
          </p>
        </div>
      )}
    </SidePanel>
  );
}
