// The pending saves of finished bridge turns, in order. One drain at a time, so a first save and an approval-resume save
// for the same chat can never race: the second waits for the first. A failed save stops the drain (later saves wait behind
// it, so order holds) until `retry`. Pure: the caller supplies the POST.
import type { SavePayload } from "./client";

/** A save the server answered with an error status. */
export class SaveHttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

/** Worth trying again: no answer at all (network), 408, 429 and 5xx. Any other 4xx will fail the same way every time. */
export const retryable = (e: unknown): boolean => {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status !== "number" || status === 408 || status === 429 || status >= 500;
};

export interface SaveJob {
  conversationId: string;
  payload: SavePayload;
}

export function createSaveQueue(o: {
  /** Saves one job; rejects when it could not be saved. */
  post: (job: SaveJob) => Promise<void>;
  /** True while a failed save waits for a retry; false again once the queue is empty. */
  onFailed: (failed: boolean) => void;
  /** A job the server refused for good (a 4xx other than 408/429): it is dropped and the queue goes on. */
  onDropped?: (job: SaveJob, e: unknown) => void;
}) {
  const jobs: SaveJob[] = [];
  let failed = false;
  let running: Promise<void> | null = null;

  async function drain() {
    while (jobs.length) {
      try {
        await o.post(jobs[0]);
        jobs.shift();
      } catch (e) {
        if (!retryable(e)) {
          o.onDropped?.(jobs.shift()!, e);
          continue;
        }
        failed = true;
        o.onFailed(true);
        return;
      }
    }
    o.onFailed(false);
  }
  function kick() {
    running ??= drain().finally(() => {
      running = null;
      if (!failed && jobs.length) void kick();
    });
    return running;
  }

  return {
    push(job: SaveJob) {
      jobs.push(job);
      return failed ? Promise.resolve() : kick();
    },
    retry() {
      failed = false;
      return kick();
    },
    get size() {
      return jobs.length;
    },
  };
}
