// The pending saves of finished bridge turns, in order. One drain at a time, so a first save and an approval-resume save
// for the same chat can never race: the second waits for the first. A failed save stops the drain (later saves wait behind
// it, so order holds) until `retry`. Pure: the caller supplies the POST.
import type { SavePayload } from "./client";

export interface SaveJob {
  conversationId: string;
  payload: SavePayload;
}

export function createSaveQueue(o: {
  /** Saves one job; rejects when it could not be saved. */
  post: (job: SaveJob) => Promise<void>;
  /** True while a failed save waits for a retry; false again once the queue is empty. */
  onFailed: (failed: boolean) => void;
}) {
  const jobs: SaveJob[] = [];
  let failed = false;
  let running: Promise<void> | null = null;

  async function drain() {
    while (jobs.length) {
      try {
        await o.post(jobs[0]);
        jobs.shift();
      } catch {
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
