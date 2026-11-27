"use client";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { RotateCw } from "lucide-react";
import type { JobStatus } from "@/lib/apps/types";
import {
  JOB_MAX_NETWORK_FAILURES,
  clampProgress,
  isTerminal,
  jobStatusUrl,
  pollDelay,
  timedOut,
} from "@/lib/generativeUi/jobPoll";
import ResultView from "./ResultView";

interface Props {
  appId: string;
  jobId: string;
  statusTool: string;
  title?: string | null;
  pollMs?: number | null;
}

type View = { status: JobStatus; slow: boolean };
const QUEUED: View = { status: { state: "queued" }, slow: false };

export default function JobCard({ appId, jobId, statusTool, title, pollMs }: Props) {
  const reduce = useReducedMotion();
  const [view, setView] = useState<View>(QUEUED);
  const [run, setRun] = useState(0); // bump to restart polling (Retry)

  const url = jobStatusUrl(appId, jobId, statusTool);
  const retry = () => {
    setView(QUEUED);
    setRun((n) => n + 1);
  };

  useEffect(() => {
    if (!url) return;
    const startedAt = Date.now();
    let attempt = 0;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ac: AbortController | undefined;
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      ac = new AbortController();
      try {
        const res = await fetch(url, { credentials: "include", headers: { "X-Orrery-Job": "1" }, signal: ac.signal });
        if (!res.ok) throw new Error(`Status check failed (${res.status})`);
        const status = (await res.json()) as JobStatus;
        if (stopped) return;
        failures = 0;
        if (isTerminal(status.state)) {
          setView({ status, slow: false });
          return;
        }
        setView((v) => ({ status, slow: v.slow }));
      } catch (e) {
        if (stopped || (e as Error).name === "AbortError") return;
        if (++failures >= JOB_MAX_NETWORK_FAILURES) {
          setView({ status: { state: "failed", error: (e as Error).message || "Could not reach the app." }, slow: false });
          return;
        }
      }
      if (timedOut(startedAt, Date.now())) {
        setView((v) => ({ status: v.status, slow: true }));
        return; // hard stop: no more timers
      }
      timer = setTimeout(tick, pollDelay(attempt++, pollMs));
    };
    tick();

    return () => {
      stopped = true;
      clearTimeout(timer);
      ac?.abort();
    };
  }, [url, pollMs, run]);

  const { status, slow } = url ? view : { status: { state: "failed", error: "This job reference is not valid." } as JobStatus, slow: false };
  const progress = clampProgress(status.progress);
  const heading = title ? <p className="text-sm font-semibold text-zinc-100">{title}</p> : null;

  if (status.state === "done" && status.result) {
    return (
      <div className="my-2 min-w-0 space-y-2">
        {heading}
        <ResultView result={status.result} appId={appId} />
      </div>
    );
  }

  if (status.state === "failed") {
    return (
      <div className="my-2 glass-card rounded-[var(--glass-radius-md)] px-4 py-3 space-y-2 min-w-0" role="alert">
        {heading}
        <p className="text-sm text-red-400">Failed{status.error ? `: ${status.error}` : ""}</p>
        <button
          onClick={retry}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--glass-radius-md)] text-sm glass-button text-zinc-300 focus-visible:outline-2 focus-visible:outline-blue-500"
        >
          <RotateCw size={14} aria-hidden /> Retry
        </button>
      </div>
    );
  }

  const label = status.state === "done" ? "Done" : slow ? "Taking longer than expected" : status.state === "queued" ? "Queued" : "Running";
  return (
    <div className="my-2 glass-card rounded-[var(--glass-radius-md)] px-4 py-3 space-y-2 min-w-0" role="status" aria-live="polite">
      {heading}
      <div className="flex items-center justify-between text-xs text-zinc-400">
        <span>{label}</span>
        {progress !== null && <span>{Math.round(progress)}%</span>}
      </div>
      <div
        className="h-1.5 rounded-full bg-[var(--glass-bg-active)] overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress ?? undefined}
        aria-label={title || "Job progress"}
      >
        <motion.div
          className="h-full rounded-full bg-blue-500"
          initial={false}
          animate={{ width: `${progress ?? (slow ? 100 : 8)}%`, opacity: progress === null && !reduce ? [0.5, 1, 0.5] : 1 }}
          transition={{
            width: { duration: reduce ? 0 : 0.3 },
            opacity: progress === null && !reduce ? { duration: 1.6, repeat: Infinity } : { duration: 0 },
          }}
        />
      </div>
      {slow && (
        <button
          onClick={retry}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--glass-radius-md)] text-sm glass-button text-zinc-300 focus-visible:outline-2 focus-visible:outline-blue-500"
        >
          <RotateCw size={14} aria-hidden /> Check again
        </button>
      )}
    </div>
  );
}
