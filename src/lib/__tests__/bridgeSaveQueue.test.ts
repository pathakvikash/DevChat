import { describe, it, expect } from "vitest";
import { createSaveQueue, retryable, SaveHttpError, type SaveJob } from "@/lib/bridge/saveQueue";

const job = (id: string): SaveJob => ({ conversationId: "c1", payload: { assistant: { id, parts: [], model: "claude-code/x" } } });

function setup(failures: Record<string, number | Error> = {}, dropped: string[] = []) {
  const posted: string[] = [];
  const flags: boolean[] = [];
  let active = 0;
  let maxActive = 0;
  const q = createSaveQueue({
    onFailed: (f) => flags.push(f),
    onDropped: (j) => dropped.push(j.payload.assistant.id),
    post: async (j) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      const id = j.payload.assistant.id;
      const f = failures[id];
      if (f instanceof Error) throw f;
      if (f) {
        failures[id] = f - 1;
        throw new Error("down");
      }
      posted.push(id);
    },
  });
  return { q, posted, flags, maxActive: () => maxActive };
}

describe("bridge save queue", () => {
  it("saves in order, one at a time, even when pushed together", async () => {
    const s = setup();
    await Promise.all([s.q.push(job("a")), s.q.push(job("b")), s.q.push(job("c"))]);
    expect(s.posted).toEqual(["a", "b", "c"]);
    expect(s.maxActive()).toBe(1);
    expect(s.flags.at(-1)).toBe(false);
  });
  it("a failure raises the flag and holds later saves behind it; retry drains in order and clears the flag", async () => {
    const s = setup({ a: 1 });
    await s.q.push(job("a"));
    await s.q.push(job("b"));
    expect(s.posted).toEqual([]);
    expect(s.flags.at(-1)).toBe(true);
    expect(s.q.size).toBe(2);
    await s.q.retry();
    expect(s.posted).toEqual(["a", "b"]);
    expect(s.q.size).toBe(0);
    expect(s.flags.at(-1)).toBe(false);
  });
  it("retries only network errors, 408, 429 and 5xx", () => {
    for (const s of [408, 429, 500, 502, 503]) expect(retryable(new SaveHttpError(s))).toBe(true);
    for (const s of [400, 401, 403, 404, 409, 413, 422]) expect(retryable(new SaveHttpError(s))).toBe(false);
    expect(retryable(new TypeError("Failed to fetch"))).toBe(true);
  });
  it("drops a job the server refused for good, reports it, and keeps draining", async () => {
    const dropped: string[] = [];
    const s = setup({ b: new SaveHttpError(409) }, dropped);
    await Promise.all([s.q.push(job("a")), s.q.push(job("b")), s.q.push(job("c"))]);
    expect(s.posted).toEqual(["a", "c"]);
    expect(dropped).toEqual(["b"]);
    expect(s.q.size).toBe(0);
    expect(s.flags.at(-1)).toBe(false);
  });
  it("holds the queue on a 503 and a 429 (retry later), unlike a 400", async () => {
    for (const status of [429, 503]) {
      const s = setup({ a: new SaveHttpError(status) });
      await s.q.push(job("a"));
      expect(s.flags.at(-1)).toBe(true);
      expect(s.q.size).toBe(1);
    }
  });
  it("keeps the flag up when a retry fails again", async () => {
    const s = setup({ a: 2 });
    await s.q.push(job("a"));
    await s.q.retry();
    expect(s.flags.at(-1)).toBe(true);
    await s.q.retry();
    expect(s.posted).toEqual(["a"]);
    expect(s.flags.at(-1)).toBe(false);
  });
});
