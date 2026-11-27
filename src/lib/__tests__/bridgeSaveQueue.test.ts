import { describe, it, expect } from "vitest";
import { createSaveQueue, type SaveJob } from "@/lib/bridge/saveQueue";

const job = (id: string): SaveJob => ({ conversationId: "c1", payload: { assistant: { id, parts: [], model: "claude-code/x" } } });

function setup(failures: Record<string, number> = {}) {
  const posted: string[] = [];
  const flags: boolean[] = [];
  let active = 0;
  let maxActive = 0;
  const q = createSaveQueue({
    onFailed: (f) => flags.push(f),
    post: async (j) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      const id = j.payload.assistant.id;
      if (failures[id]) {
        failures[id]--;
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
