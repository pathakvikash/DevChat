// Scheduling rules for live (refreshing) results, kept pure so they can be unit tested.
export const LIVE_MIN_MS = 2000;
export const LIVE_MAX_MS = 60_000;
export const LIVE_DEFAULT_MS = 5000;
export const LIVE_MAX_FAILURES = 5;
export const LIVE_SESSION_MS = 15 * 60 * 1000;

/** The app's `everyMs` clamped to 2 s..60 s; 5 s when missing or not a finite number. */
export function clampEvery(everyMs?: number | null): number {
  if (typeof everyMs !== "number" || !Number.isFinite(everyMs)) return LIVE_DEFAULT_MS;
  return Math.min(LIVE_MAX_MS, Math.max(LIVE_MIN_MS, everyMs));
}

/** Delay before the next poll: the interval doubled per consecutive failure, capped at 60 s. */
export function liveDelay(everyMs: number, failures: number): number {
  return Math.min(LIVE_MAX_MS, everyMs * 2 ** Math.max(failures, 0));
}

export const liveFailed = (failures: number) => failures >= LIVE_MAX_FAILURES;
export const liveExpired = (startedAt: number, now: number) => now - startedAt >= LIVE_SESSION_MS;
