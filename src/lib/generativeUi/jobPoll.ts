// Poll scheduling for JobCard, kept pure so it can be unit tested.
import { isAppId } from "./appData";

export const JOB_TIMEOUT_MS = 10 * 60 * 1000;
export const JOB_BACKOFF_CAP_MS = 5000;
export const JOB_MAX_NETWORK_FAILURES = 5;

/** Delay before poll number `attempt` (0-based): `pollMs` for 3 polls, then +50% each poll up to the cap. */
export function pollDelay(attempt: number, pollMs?: number | null): number {
  const base = Math.max(500, pollMs && Number.isFinite(pollMs) ? pollMs : 2000);
  const cap = Math.max(JOB_BACKOFF_CAP_MS, base);
  return Math.min(cap, Math.round(base * 1.5 ** Math.max(attempt - 2, 0)));
}

export const isTerminal = (state: string) => state === "done" || state === "failed";
export const timedOut = (startedAt: number, now: number) => now - startedAt >= JOB_TIMEOUT_MS;

export function jobStatusUrl(appId: string, jobId: string, statusTool: string): string | null {
  if (!isAppId(appId) || !jobId || !statusTool) return null;
  return `/api/apps/${appId}/jobs/${encodeURIComponent(jobId)}?tool=${encodeURIComponent(statusTool)}`;
}

export const clampProgress = (p: unknown): number | null =>
  typeof p === "number" && Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : null;
