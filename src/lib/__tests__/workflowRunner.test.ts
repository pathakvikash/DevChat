import { describe, it, expect, vi, beforeEach } from "vitest";

// An in-memory WorkflowRun table: just the calls the runner makes.
const runs = new Map<string, any>();
const saves: Array<Record<string, unknown>> = [];
const matches = (r: any, where: Record<string, any>) =>
  Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("lt" in v) return r[k] < v.lt;
      if ("in" in v) return v.in.includes(r[k]);
      if ("not" in v) return r[k] !== v.not;
    }
    return r[k] === v;
  });
let failProgressSave = false;
let workflowRow: any = null;
const chats = new Set<string>();
const dataTables = new Map<string, { id: string; userId: string; name: string; privateFrom: string; statuses?: string }>();
// Rows of the tables above, for Pick rows (phase 3).
const tableRows = new Map<string, { id: string; tableId: string; status: string; data: string }>();
vi.mock("@/lib/db", () => {
  const prisma: any = {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    dataTableRow: {
      count: vi.fn(async ({ where }: any) => [...tableRows.values()].filter((r) => r.tableId === where.tableId && where.status.in.includes(r.status)).length),
      findMany: vi.fn(async ({ where }: any) => [...tableRows.values()].filter((r) => r.tableId === where.tableId && where.id.in.includes(r.id) && where.status.in.includes(r.status))),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const r of tableRows.values()) if (r.tableId === where.tableId && where.id.in.includes(r.id)) (Object.assign(r, data), count++);
        return { count };
      }),
    },
    mcpServer: { findFirst: vi.fn(async () => ({ id: "s1", name: "gh" })) },
    workflow: { findFirst: vi.fn(async ({ where }: any) => (workflowRow && workflowRow.id === where.id && workflowRow.userId === where.userId ? workflowRow : null)) },
    conversation: { findFirst: vi.fn(async ({ where }: any) => (chats.has(where.id) ? { id: where.id } : null)) },
    dataTable: {
      findFirst: vi.fn(async ({ where }: any) => {
        const t = dataTables.get(where.id);
        return t && t.userId === where.userId ? t : null;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const t = dataTables.get(where.id);
        if (!t || t.userId !== where.userId || (where.privateFrom !== undefined && t.privateFrom !== where.privateFrom)) return { count: 0 };
        Object.assign(t, data);
        return { count: 1 };
      }),
    },
    workflowRun: {
      findUnique: vi.fn(async ({ where }: any) => (runs.has(where.id) ? { ...runs.get(where.id), workflow: { name: "WF" } } : null)),
      findFirst: vi.fn(async ({ where }: any) => [...runs.values()].find((r) => matches(r, where)) ?? null),
      findMany: vi.fn(async ({ where, skip = 0 }: any) => [...runs.values()].filter((r) => matches(r, where)).slice(skip)),
      deleteMany: vi.fn(async ({ where }: any) => {
        for (const id of where.id.in) runs.delete(id);
        return { count: where.id.in.length };
      }),
      count: vi.fn(async ({ where }: any) => [...runs.values()].filter((r) => matches(r, where)).length),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `run${runs.size + 1}`, attempt: 0, nodes: "{}", error: null, inputTokens: 0, outputTokens: 0, heartbeatAt: new Date(), startedAt: new Date(), endedAt: null, ...data };
        runs.set(row.id, row);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (failProgressSave && "nodes" in data && !("state" in data)) {
          failProgressSave = false;
          throw new Error("database is locked");
        }
        let count = 0;
        for (const r of runs.values()) {
          if (!matches(r, where)) continue;
          for (const [k, v] of Object.entries(data)) r[k] = v && typeof v === "object" && "increment" in (v as object) ? r[k] + (v as any).increment : v;
          count++;
          if ("nodes" in data) saves.push(data);
        }
        return { count };
      }),
    },
  };
  prisma.dataTable.update = vi.fn(async ({ where, data }: any) => Object.assign(dataTables.get(where.id)!, data));
  return { prisma };
});
const callServerTool = vi.fn();
vi.mock("@/lib/mcp/client", () => ({ listServerTools: vi.fn(async () => [{ name: "create_issue" }]), callServerTool: (...a: unknown[]) => callServerTool(...a) }));
vi.mock("@/lib/hostAccess", () => ({ canUseHostTools: vi.fn(async () => true), HOST_TOOLS_REFUSED: "This is only available to the server's owner." }));
vi.mock("@/lib/workflows/cards/agent", async (orig) => ({ ...(await orig<object>()), resolveAgentModel: vi.fn() }));

import { advanceRun, cancelRun, capOutput, continueRun, markPrivateTables, preflight, resetShutdownForTests, resumeRun, startRun, stopAllRuns, sweepOrphans, type RunnerDeps } from "@/lib/workflows/runner";
import { resolveAgentModel } from "@/lib/workflows/cards/agent";
import { mcpToolCard } from "@/lib/workflows/cards/mcpTool";
import { pickRowsCard } from "@/lib/workflows/cards/pickRows";
import { emptyGraph, type CardRun, type FlowNode, type WorkflowGraph } from "@/lib/workflows/graph";
import type { CardCtx, CardImpl } from "@/lib/workflows/cards";

const agentNode = (id: string, fromIds: string[], x: number, config: Record<string, unknown> = {}): FlowNode => ({
  id,
  type: "agent",
  fromIds,
  config: { instructions: "do it", ...config },
  ui: { label: id.toUpperCase(), position: { x, y: 0 } },
});

function seedRun(graph: WorkflowGraph, over: Record<string, unknown> = {}, id = "run1") {
  runs.set(id, {
    id,
    workflowId: "wf1",
    userId: "u1",
    state: "running",
    attempt: 0,
    graph: JSON.stringify(graph),
    nodes: "{}",
    error: null,
    inputTokens: 0,
    outputTokens: 0,
    heartbeatAt: new Date(),
    startedAt: new Date("2026-11-09T10:00:00Z"),
    endedAt: null,
    ...over,
  });
  return id;
}

const graphOf = (...nodes: FlowNode[]): WorkflowGraph => ({ ...emptyGraph("mock/workflow"), nodes: [emptyGraph().nodes[0], ...nodes] });
const nodesOf = (id = "run1"): Record<string, CardRun> => JSON.parse(runs.get(id).nodes);

/** Fake cards: `agent` runs `onAgent`; the trigger and the rest just succeed. */
function deps(onAgent: (c: CardCtx) => Promise<any> | any): { deps: RunnerDeps; ran: string[] } {
  const ran: string[] = [];
  const agent: CardImpl = {
    run: async (c) => {
      ran.push(c.node.id);
      return onAgent(c);
    },
    concurrency: () => 3,
  };
  const plain: CardImpl = { run: async (c) => ({ output: { ok: c.node.id } }) };
  return { deps: { cards: { trigger: plain, webSearch: plain, chatMessage: plain, agent } }, ran };
}

beforeEach(() => {
  runs.clear();
  saves.length = 0;
  failProgressSave = false;
  resetShutdownForTests();
  workflowRow = null;
  chats.clear();
  dataTables.clear();
  tableRows.clear();
});

/** A card that waits until released (or aborted, if `onAbort`). */
function gate() {
  let release!: () => void;
  const open = new Promise<void>((r) => (release = r));
  return { open, release };
}

describe("advanceRun", () => {
  it("runs the cards in order and hands each one the outputs of the cards before it", async () => {
    const seen: Record<string, unknown>[] = [];
    const { deps: d, ran } = deps((c) => {
      seen.push({ ...c.tctx.nodes });
      return { output: { text: `out-${c.node.id}` } };
    });
    seedRun(graphOf(agentNode("a", ["trigger"], 1), agentNode("b", ["a"], 2)));
    await advanceRun("run1", d);
    expect(ran).toEqual(["a", "b"]);
    expect(Object.keys(seen[1])).toEqual(["trigger", "a"]);
    expect(runs.get("run1")).toMatchObject({ state: "succeeded", error: null });
    expect(runs.get("run1").endedAt).toBeInstanceOf(Date);
    expect(Object.values(nodesOf()).map((n) => n.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
  });

  it("saves once per card status change, plus once to finish", async () => {
    const { deps: d } = deps(() => ({ output: { text: "x" } }));
    seedRun(graphOf(agentNode("a", ["trigger"], 1), agentNode("b", ["a"], 2)));
    await advanceRun("run1", d);
    // 3 cards x (running, done) + the final state
    expect(saves).toHaveLength(7);
  });

  it("fails a card, skips what follows it, and still runs a sibling", async () => {
    const { deps: d, ran } = deps((c) => {
      if (c.node.id === "bad") throw new Error("model blew up");
      return { output: { text: "fine" } };
    });
    seedRun(graphOf(agentNode("bad", ["trigger"], 1), agentNode("child", ["bad"], 2), agentNode("sibling", ["trigger"], 3), agentNode("grandchild", ["child"], 4)));
    await advanceRun("run1", d);
    const n = nodesOf();
    expect(ran).toEqual(["bad", "sibling"]);
    expect(n.bad).toMatchObject({ status: "failed", error: "model blew up" });
    expect(n.child).toMatchObject({ status: "skipped", skippedReason: "BAD failed" });
    expect(n.grandchild).toMatchObject({ status: "skipped", skippedReason: "BAD failed" });
    expect(n.sibling.status).toBe("succeeded");
    expect(runs.get("run1")).toMatchObject({ state: "failed" });
    expect(runs.get("run1").error).toContain("BAD failed: model blew up");
  });

  it("stops quietly when a save changes no row (the run was cancelled)", async () => {
    const { deps: d, ran } = deps((c) => {
      runs.get("run1").state = "cancelled"; // another process cancelled it mid-card
      return { output: { text: c.node.id } };
    });
    seedRun(graphOf(agentNode("a", ["trigger"], 1), agentNode("b", ["a"], 2)));
    await advanceRun("run1", d);
    expect(ran).toEqual(["a"]);
    expect(runs.get("run1").state).toBe("cancelled");
  });

  it("cancelRun aborts a card in this process", async () => {
    let signal!: AbortSignal;
    const { deps: d } = deps(
      (c) =>
        new Promise((_, reject) => {
          signal = c.signal;
          c.signal.addEventListener("abort", () => reject(new Error("Cancelled")));
        }),
    );
    seedRun(graphOf(agentNode("a", ["trigger"], 1)));
    const done = advanceRun("run1", d);
    await vi.waitFor(() => expect(signal).toBeDefined());
    expect(await cancelRun("u1", "run1")).toBe(true);
    await done;
    expect(signal.aborted).toBe(true);
    expect(runs.get("run1").state).toBe("cancelled");
    expect(await cancelRun("u1", "run1")).toBe(false);
  });

  it("fails the run when the token limit is passed, before the next card", async () => {
    const { deps: d, ran } = deps(() => ({ output: { text: "x" }, usage: { inputTokens: 900, outputTokens: 400 } }));
    seedRun({ ...graphOf(agentNode("a", ["trigger"], 1), agentNode("b", ["a"], 2)), maxRunTokens: 1000 });
    await advanceRun("run1", d);
    expect(ran).toEqual(["a"]);
    expect(runs.get("run1")).toMatchObject({ state: "failed", error: "Token limit for this run reached", inputTokens: 900, outputTokens: 400 });
  });

  it("does not start a run that is not running", async () => {
    const { deps: d, ran } = deps(() => ({ output: {} }));
    seedRun(graphOf(agentNode("a", ["trigger"], 1)), { state: "cancelled" });
    await advanceRun("run1", d);
    expect(ran).toEqual([]);
  });

  it("does not start a second loop for a run that already has one for this attempt", async () => {
    const g = gate();
    const { deps: d, ran } = deps(() => g.open.then(() => ({ output: {} })));
    seedRun(graphOf(agentNode("a", ["trigger"], 1)));
    const first = advanceRun("run1", d);
    await vi.waitFor(() => expect(ran).toEqual(["a"]));
    await advanceRun("run1", d); // returns at once
    expect(ran).toEqual(["a"]);
    g.release();
    await first;
    expect(runs.get("run1").state).toBe("succeeded");
  });

  describe("per-item cards", () => {
    const perItem = (config: Record<string, unknown> = {}) =>
      graphOf(agentNode("a", ["trigger"], 1, { perItem: true, items: "{{trigger.list}}", ...config }));
    const triggerWith = (list: unknown[]): RunnerDeps["cards"]["trigger"] => ({ run: async () => ({ output: { list } }) });

    it("runs items 3 at a time, caps at maxItems with a warning, and merges item and result", async () => {
      let live = 0;
      let peak = 0;
      const { deps: d } = deps(async (c) => {
        live++;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 2));
        live--;
        return { output: { score: c.tctx.index }, usage: { inputTokens: 1, outputTokens: 1 } };
      });
      d.cards.trigger = triggerWith(Array.from({ length: 40 }, (_, i) => ({ url: `u${i}` })));
      seedRun(perItem());
      await advanceRun("run1", d);
      const a = nodesOf().a;
      expect(peak).toBe(3);
      expect(a.items).toEqual({ done: 25, failed: 0, total: 25 });
      expect(a.warnings).toContain("Ran on the first 25 of 40 items");
      const out = a.output as { items: { url: string; score: number }[]; count: number };
      expect(out.count).toBe(25);
      expect(out.items[0]).toEqual({ url: "u0", score: 1 }); // item fields stay, the card's result is added, index is 1-based
      expect(a.usage).toEqual({ inputTokens: 25, outputTokens: 25 });
    });

    it("runs an MCP tool card once per item, fails an item on isError, and merges the result into the item", async () => {
      callServerTool.mockReset();
      callServerTool.mockImplementation(async (_s: string, _t: string, args: { title: string }) =>
        args.title === "u2" ? { content: [{ type: "text", text: "no" }], isError: true } : { content: [{ type: "text", text: `{"ok":"${args.title}"}` }] },
      );
      const g = graphOf({ id: "m", type: "mcpTool", fromIds: ["trigger"], config: { serverId: "s1", tool: "create_issue", args: { title: "{{item.url}}" }, perItem: true, items: "{{trigger.list}}" }, ui: { label: "M", position: { x: 1, y: 0 } } });
      const { deps: d } = deps(() => ({ output: {} }));
      d.cards.mcpTool = mcpToolCard;
      d.cards.trigger = triggerWith([{ url: "u1" }, { url: "u2" }, { url: "u3" }]);
      seedRun(g);
      await advanceRun("run1", d);
      const m = nodesOf().m;
      expect(m.status).toBe("succeeded");
      expect(m.itemErrors).toEqual([{ index: 2, error: "no" }]);
      const out = m.output as { items: Record<string, unknown>[]; count: number; failed: number };
      expect(out).toMatchObject({ count: 2, failed: 1 });
      expect(out.items[0]).toMatchObject({ url: "u1", text: '{"ok":"u1"}', data: { ok: "u1" } });
      expect(callServerTool).toHaveBeenCalledTimes(3);
    });

    it("leaves failed items out and lists them; fails the card when every item fails; skips on an empty list", async () => {
      const { deps: d } = deps((c) => {
        if (c.tctx.index === 2) throw new Error("bad item");
        return { output: { ok: true } };
      });
      d.cards.trigger = triggerWith([{ n: 1 }, { n: 2 }, { n: 3 }]);
      seedRun(perItem());
      await advanceRun("run1", d);
      let a = nodesOf().a;
      expect(a.status).toBe("succeeded");
      expect(a.itemErrors).toEqual([{ index: 2, error: "bad item" }]);
      expect((a.output as { count: number; failed: number })).toMatchObject({ count: 2, failed: 1 });

      const all = deps(() => {
        throw new Error("nope");
      });
      all.deps.cards.trigger = triggerWith([1, 2]);
      seedRun(perItem(), {}, "run2");
      await advanceRun("run2", all.deps);
      expect(nodesOf("run2").a).toMatchObject({ status: "failed", error: "Every item failed: nope" });

      const none = deps(() => ({ output: {} }));
      none.deps.cards.trigger = triggerWith([]);
      seedRun(graphOf(agentNode("a", ["trigger"], 1, { perItem: true, items: "{{trigger.list}}" }), agentNode("b", ["a"], 2)), {}, "run3");
      await advanceRun("run3", none.deps);
      a = nodesOf("run3").a;
      expect(a).toMatchObject({ status: "skipped", skippedReason: "No items" });
      expect(nodesOf("run3").b).toMatchObject({ status: "skipped", skippedReason: "No items" });
    });

    it("fails the card when Items is not a list", async () => {
      const { deps: d } = deps(() => ({ output: {} }));
      seedRun(graphOf(agentNode("a", ["trigger"], 1, { perItem: true, items: "{{trigger.date}}" })));
      await advanceRun("run1", d);
      expect(nodesOf().a).toMatchObject({ status: "failed", error: "Items must be a list" });
    });
  });
});

describe("sweepOrphans", () => {
  it("marks only running runs whose heartbeat is over 60 s old as interrupted", async () => {
    const now = Date.parse("2026-11-09T12:00:00Z");
    const g = graphOf();
    seedRun(g, { heartbeatAt: new Date(now - 61_000) }, "stale");
    seedRun(g, { heartbeatAt: new Date(now - 30_000) }, "fresh");
    seedRun(g, { state: "waiting", heartbeatAt: new Date(now - 600_000) }, "waiting");
    seedRun(g, { state: "succeeded", heartbeatAt: new Date(now - 600_000) }, "done");
    seedRun(g, { userId: "someone-else", heartbeatAt: new Date(now - 600_000) }, "theirs");
    expect(await sweepOrphans("u1", now)).toBe(1);
    expect(["stale", "fresh", "waiting", "done", "theirs"].map((id) => runs.get(id).state)).toEqual(["interrupted", "running", "waiting", "succeeded", "running"]);
    expect(runs.get("stale").endedAt).toEqual(new Date(now));
  });
});

describe("resume after interruption", () => {
  it("continues from the interrupted card and keeps the outputs that already succeeded", async () => {
    const { deps: d, ran } = deps((c) => ({ output: { text: `out-${c.node.id}` } }));
    const g = graphOf(agentNode("a", ["trigger"], 1), agentNode("b", ["a"], 2), agentNode("c", ["b"], 3));
    // The server stopped while b was running.
    seedRun(g, {
      state: "interrupted",
      endedAt: new Date(),
      nodes: JSON.stringify({
        trigger: { status: "succeeded", output: { date: "2026-11-09" } },
        a: { status: "succeeded", output: { text: "kept" } },
        b: { status: "running" },
      }),
    });
    const r = await resumeRun("u1", "run1");
    expect(r).toEqual({ ok: true, runId: "run1" });
    expect(runs.get("run1")).toMatchObject({ state: "running", error: null, endedAt: null });
    expect(nodesOf().b).toBeUndefined();

    await advanceRun("run1", d);
    expect(ran).toEqual(["b", "c"]); // a was not run again
    expect(nodesOf().a.output).toEqual({ text: "kept" });
    expect(runs.get("run1").state).toBe("succeeded");
  });

  it("also resumes a failed run, and refuses a run that is running or done", async () => {
    const g = graphOf(agentNode("a", ["trigger"], 1));
    seedRun(g, { state: "failed", nodes: JSON.stringify({ trigger: { status: "succeeded" }, a: { status: "failed", error: "x" } }) }, "f");
    expect((await resumeRun("u1", "f")).ok).toBe(true);
    seedRun(g, { state: "succeeded" }, "s");
    expect(await resumeRun("u1", "s")).toMatchObject({ ok: false, status: 409 });
    expect(await resumeRun("u1", "missing")).toMatchObject({ ok: false, status: 404 });
    expect(await resumeRun("other", "f")).toMatchObject({ ok: false, status: 404 });
  });

  it("will not resume while another run of the workflow is in progress", async () => {
    const g = graphOf();
    seedRun(g, { state: "interrupted" }, "old");
    seedRun(g, { state: "running" }, "new");
    expect(await resumeRun("u1", "old")).toMatchObject({ ok: false, status: 409, runId: "new" });
  });
});

describe("cancel, heartbeat and shutdown", () => {
  it("cancelRun does not abort a run that belongs to someone else", async () => {
    const g = gate();
    let signal!: AbortSignal;
    const { deps: d, ran } = deps((c) => {
      signal = c.signal;
      return g.open.then(() => ({ output: {} }));
    });
    seedRun(graphOf(agentNode("a", ["trigger"], 1)), { userId: "u2" });
    const loop = advanceRun("run1", d);
    await vi.waitFor(() => expect(ran).toEqual(["a"]));
    expect(await cancelRun("u1", "run1")).toBe(false);
    expect(signal.aborted).toBe(false);
    expect(runs.get("run1").state).toBe("running");
    g.release();
    await loop;
    expect(runs.get("run1").state).toBe("succeeded");
  });

  it("the heartbeat aborts the run when another process cancelled it", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      let signal!: AbortSignal;
      const { deps: d, ran } = deps(
        (c) =>
          new Promise((_, reject) => {
            signal = c.signal;
            c.signal.addEventListener("abort", () => reject(new Error("Cancelled")));
          }),
      );
      seedRun(graphOf(agentNode("a", ["trigger"], 1)));
      const loop = advanceRun("run1", d);
      await vi.waitFor(() => expect(ran).toEqual(["a"]));
      runs.get("run1").state = "cancelled"; // another process did it
      await vi.advanceTimersByTimeAsync(15_000);
      await loop;
      expect(signal.aborted).toBe(true);
      expect(runs.get("run1").state).toBe("cancelled");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shutdown aborts the loop and leaves no final save, so the run goes stale and can be resumed", async () => {
    let signal!: AbortSignal;
    const { deps: d, ran } = deps(
      (c) =>
        new Promise((_, reject) => {
          signal = c.signal;
          c.signal.addEventListener("abort", () => reject(new Error("Cancelled")));
        }),
    );
    seedRun(graphOf(agentNode("a", ["trigger"], 1), agentNode("b", ["a"], 2)));
    const loop = advanceRun("run1", d);
    await vi.waitFor(() => expect(ran).toEqual(["a"]));
    stopAllRuns();
    await loop;
    expect(signal.aborted).toBe(true);
    expect(runs.get("run1")).toMatchObject({ state: "running", endedAt: null, error: null });
    expect(nodesOf().a.status).toBe("running"); // not recorded as failed
    expect(nodesOf().b).toBeUndefined();

    // Stale, then Interrupted, then Resume finishes it (in a restarted process).
    resetShutdownForTests();
    runs.get("run1").heartbeatAt = new Date(Date.now() - 120_000);
    expect(await sweepOrphans("u1")).toBe(1);
    expect(await resumeRun("u1", "run1")).toEqual({ ok: true, runId: "run1" });
    const next = deps(() => ({ output: { text: "ok" } }));
    await advanceRun("run1", next.deps);
    expect(next.ran).toEqual(["a", "b"]);
    expect(runs.get("run1").state).toBe("succeeded");
  });
});

describe("resume races", () => {
  it("a Resume bumps the attempt, and the older loop's writes then match no row", async () => {
    const g = gate();
    const old = deps(() => g.open.then(() => ({ output: { text: "old" } })));
    seedRun(graphOf(agentNode("a", ["trigger"], 1), agentNode("b", ["a"], 2)));
    const oldLoop = advanceRun("run1", old.deps);
    await vi.waitFor(() => expect(old.ran).toEqual(["a"]));

    // The run was thought dead (heartbeat gap) and resumed while the old loop was still alive.
    runs.get("run1").state = "interrupted";
    expect(await resumeRun("u1", "run1")).toEqual({ ok: true, runId: "run1" });
    expect(runs.get("run1").attempt).toBe(1);
    const fresh = deps((c) => ({ output: { text: `new-${c.node.id}` } }));
    await advanceRun("run1", fresh.deps);
    expect(runs.get("run1").state).toBe("succeeded");
    expect(fresh.ran).toEqual(["a", "b"]);

    g.release(); // the old card finishes late
    await oldLoop;
    expect(old.ran).toEqual(["a"]); // it never went on to b
    expect(nodesOf().a.output).toEqual({ text: "new-a" }); // and its result was not written
    expect(runs.get("run1")).toMatchObject({ state: "succeeded", attempt: 1 });
  });
});

describe("per-item checkpoint and token cap", () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ n: i + 1 }));
  const withItems = (d: RunnerDeps, list: unknown[]) => {
    d.cards.trigger = { run: async () => ({ output: { list } }) };
    return d;
  };
  const perItemGraph = () => graphOf(agentNode("a", ["trigger"], 1, { perItem: true, items: "{{trigger.list}}" }));

  it("interrupted mid-way, a resume runs only the items that had not finished", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); // progress saves are throttled to one per 2 s
    try {
      const g = gate();
      const firstRun: number[] = [];
      const first = deps(async (c) => {
        const i = c.tctx.index as number;
        firstRun.push(i);
        vi.setSystemTime(Date.now() + 3000);
        if (i === 3) await g.open; // stuck here: the host cut the run
        return { output: { done: i } };
      });
      first.deps.cards.agent = { ...first.deps.cards.agent, concurrency: () => 1 };
      seedRun(perItemGraph());
      const loop = advanceRun("run1", withItems(first.deps, items(5)));
      await vi.waitFor(() => expect(Object.keys(nodesOf().a.partial?.results ?? {})).toEqual(["0", "1"]));
      stopAllRuns();
      g.release();
      await loop;
      expect(firstRun).toEqual([1, 2, 3]);

      resetShutdownForTests(); // the restarted process
      runs.get("run1").heartbeatAt = new Date(Date.now() - 120_000);
      await sweepOrphans("u1");
      expect(await resumeRun("u1", "run1")).toEqual({ ok: true, runId: "run1" });
      expect(nodesOf().a.partial?.total).toBe(5); // the finished items survived the reset

      const second: number[] = [];
      const resumed = deps((c) => {
        second.push(c.tctx.index as number);
        return { output: { done: c.tctx.index } };
      });
      await advanceRun("run1", withItems(resumed.deps, items(5)));
      expect(second.sort()).toEqual([3, 4, 5]); // items 1 and 2 were not run again
      const a = nodesOf().a;
      expect(a.status).toBe("succeeded");
      expect((a.output as { items: { n: number; done: number }[] }).items.map((x) => x.n)).toEqual([1, 2, 3, 4, 5]);
      expect(a.partial).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a checkpoint when the list is a different size", async () => {
    seedRun(perItemGraph(), {
      state: "running",
      nodes: JSON.stringify({ trigger: { status: "succeeded", output: { list: items(3) } }, a: { status: "running", partial: { total: 9, results: { 0: { stale: true } }, usage: { inputTokens: 0, outputTokens: 0 } } } }),
    });
    const ran: number[] = [];
    const d = deps((c) => {
      ran.push(c.tctx.index as number);
      return { output: {} };
    });
    await advanceRun("run1", withItems(d.deps, items(3)));
    expect(ran.sort()).toEqual([1, 2, 3]);
  });

  it("checks the run's token cap before each item, and counts the tokens spent", async () => {
    const d = deps(() => ({ output: {}, usage: { inputTokens: 300, outputTokens: 100 } }));
    d.deps.cards.agent = { ...d.deps.cards.agent, concurrency: () => 1 };
    seedRun({ ...perItemGraph(), maxRunTokens: 1000 });
    await advanceRun("run1", withItems(d.deps, items(10)));
    expect(d.ran).toEqual(["a", "a", "a"]); // 400, 800, then 1200 > 1000 stops the fourth
    expect(runs.get("run1")).toMatchObject({ state: "failed", inputTokens: 900, outputTokens: 300 });
    expect(nodesOf().a).toMatchObject({ status: "failed", error: "Token limit for this run reached" });
  });

  it("a failing progress save is logged and the run carries on", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps(() => {
      failProgressSave = true; // the next save is the item-progress one
      return { output: {} };
    });
    seedRun(perItemGraph());
    await advanceRun("run1", withItems(d.deps, items(2)));
    expect(runs.get("run1").state).toBe("succeeded");
    expect(err).toHaveBeenCalledWith("[workflows] progress save failed:", "database is locked");
    err.mockRestore();
  });
});

describe("startRun", () => {
  const model = (over: Record<string, unknown> = {}) => ({ id: "gpt-4o", name: "GPT-4o", supportsTools: true, ...over });
  const agent = (over: Record<string, unknown> = {}) => agentNode("a", ["trigger"], 1, over);
  const withWorkflow = (g: WorkflowGraph, userId = "u1") => {
    workflowRow = { id: "wf1", userId, name: "WF", graph: JSON.stringify(g) };
  };
  beforeEach(() => {
    vi.mocked(resolveAgentModel).mockReset();
    vi.mocked(resolveAgentModel).mockResolvedValue(model() as never);
  });

  it("creates a running run with a snapshot of the graph", async () => {
    const g = graphOf(agent());
    withWorkflow(g);
    const r = await startRun("u1", "wf1");
    expect(r).toMatchObject({ ok: true });
    const row = [...runs.values()][0];
    expect(row).toMatchObject({ workflowId: "wf1", userId: "u1", state: "running", nodes: "{}" });
    expect(JSON.parse(row.graph).nodes).toHaveLength(2);
  });

  it("404 for a workflow that is not the user's", async () => {
    withWorkflow(graphOf(agent()), "u2");
    expect(await startRun("u1", "wf1")).toMatchObject({ ok: false, status: 404 });
  });

  it("refuses a graph with config problems, naming the card", async () => {
    withWorkflow(graphOf(agent({ instructions: "" })));
    const r = await startRun("u1", "wf1");
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect((r as any).errors[0]).toMatchObject({ nodeId: "a", message: expect.stringContaining("add instructions") });
    expect(runs.size).toBe(0);
  });

  it("refuses a missing model, naming the card", async () => {
    vi.mocked(resolveAgentModel).mockRejectedValue(new Error("OpenAI is not configured"));
    withWorkflow(graphOf(agent()));
    expect(await startRun("u1", "wf1")).toMatchObject({ ok: false, status: 400, error: "A: OpenAI is not configured" });
  });

  it("refuses tools on a model that cannot use them", async () => {
    vi.mocked(resolveAgentModel).mockResolvedValue(model({ name: "Tiny", supportsTools: false }) as never);
    withWorkflow(graphOf(agent({ tools: ["calculator"] })));
    expect(await startRun("u1", "wf1")).toMatchObject({ ok: false, status: 400, error: "A: Tiny can't use tools. Untick the tools or pick another model." });
    withWorkflow(graphOf(agent({ tools: [] }))); // no tools, so the same model is fine
    expect(await startRun("u1", "wf1")).toMatchObject({ ok: true });
  });

  it("refuses Codex as a workflow card model until a live check is done", async () => {
    vi.mocked(resolveAgentModel).mockResolvedValue(model({ id: "codex/default", name: "Codex" }) as never);
    withWorkflow(graphOf(agent({ model: "codex/default" })));
    const r = await startRun("u1", "wf1");
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect((r as any).error).toContain("Codex can't run workflow cards yet");
  });

  it("refuses a card that reads chats and reaches the web", async () => {
    withWorkflow(graphOf(agent({ tools: ["readChat", "fetchUrl"] })));
    const r = await startRun("u1", "wf1");
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect((r as any).error).toContain("This card can read your chats and reach the web. Pick one");
    expect((r as any).errors).toEqual([{ nodeId: "a", message: expect.any(String) }]); // listed once, on the card
  });

  it("refuses a chat card that points at a chat that is gone", async () => {
    const chat: FlowNode = { id: "post", type: "chatMessage", fromIds: ["trigger"], config: { chat: "gone", message: "hi" }, ui: { label: "Post", position: { x: 1, y: 0 } } };
    withWorkflow(graphOf(chat));
    expect(await startRun("u1", "wf1")).toMatchObject({ ok: false, status: 400, error: "Post: that chat no longer exists" });
    chats.add("gone");
    expect(await startRun("u1", "wf1")).toMatchObject({ ok: true });
  });

  it("429 when two runs are already running, 409 with the run id when this workflow has one", async () => {
    withWorkflow(graphOf(agent()));
    seedRun(graphOf(), { workflowId: "other1" }, "r1");
    seedRun(graphOf(), { workflowId: "other2" }, "r2");
    expect(await startRun("u1", "wf1")).toMatchObject({ ok: false, status: 429, error: "Two runs are already running. Wait or cancel one." });
    runs.clear();
    seedRun(graphOf(), { workflowId: "wf1", state: "waiting" }, "mine");
    expect(await startRun("u1", "wf1")).toMatchObject({ ok: false, status: 409, runId: "mine", error: "This workflow already has a run in progress." });
  });

  it("marks a stale run of this user Interrupted first, so it does not count against the caps", async () => {
    withWorkflow(graphOf(agent()));
    seedRun(graphOf(), { workflowId: "wf1", heartbeatAt: new Date(Date.now() - 120_000) }, "stale");
    expect(await startRun("u1", "wf1")).toMatchObject({ ok: true });
    expect(runs.get("stale").state).toBe("interrupted");
  });

  it("prunes runs beyond the newest 50", async () => {
    withWorkflow(graphOf(agent()));
    for (let i = 0; i < 52; i++) seedRun(graphOf(), { workflowId: "wf1", state: "succeeded" }, `old${i}`);
    await startRun("u1", "wf1");
    expect(runs.size).toBe(50); // 53 rows, the 3 beyond the newest 50 deleted
  });
});

describe("follow-ups", () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ n: i + 1 }));
  const perItemGraph = () => graphOf(agentNode("a", ["trigger"], 1, { perItem: true, items: "{{trigger.list}}" }));

  it("keeps the last checkpoint that fit when the results grow past 200 KB", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const g = gate();
      const d = deps(async (c) => {
        vi.setSystemTime(Date.now() + 3000);
        if (c.tctx.index === 3) await g.open;
        return { output: { big: "x".repeat(100_000) } };
      });
      d.deps.cards.agent = { ...d.deps.cards.agent, concurrency: () => 1 };
      d.deps.cards.trigger = { run: async () => ({ output: { list: items(3) } }) };
      seedRun(perItemGraph());
      const loop = advanceRun("run1", d.deps);
      await vi.waitFor(() => expect(d.ran).toHaveLength(3));
      await vi.waitFor(() => expect(nodesOf().a.partial).toBeDefined());
      // Item 2 pushed the saved results over the cap, so the checkpoint is still the one with item 1 only.
      expect(Object.keys(nodesOf().a.partial!.results)).toEqual(["0"]);
      stopAllRuns();
      g.release();
      await loop;
    } finally {
      vi.useRealTimers();
    }
  });

  it("a run started after the shutdown signal does nothing and stays resumable", async () => {
    const d = deps(() => ({ output: {} }));
    seedRun(graphOf(agentNode("a", ["trigger"], 1)));
    stopAllRuns();
    await advanceRun("run1", d.deps);
    expect(d.ran).toEqual([]);
    expect(runs.get("run1")).toMatchObject({ state: "running", endedAt: null });
    runs.get("run1").heartbeatAt = new Date(Date.now() - 120_000);
    expect(await sweepOrphans("u1")).toBe(1);
  });

  it("capOutput cuts one long text field instead of replacing the whole output", () => {
    const text = 'say "hi"\n'.repeat(30_000); // about 270k characters, more after JSON escaping
    const out = capOutput({ text }) as { text: string; truncated: boolean };
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBeGreaterThan(50_000);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(200_000);
    expect(capOutput({ text: "short" })).toEqual({ text: "short" });
    expect(capOutput({ a: 1, big: [1].concat(new Array(100_000).fill(1234567)) })).toEqual({ truncated: true });
  });

  it("counts the tokens of failed items toward the run's cap", async () => {
    const d = deps(() => {
      throw Object.assign(new Error("model failed"), { usage: { inputTokens: 400, outputTokens: 100 } });
    });
    d.deps.cards.agent = { ...d.deps.cards.agent, concurrency: () => 1 };
    d.deps.cards.trigger = { run: async () => ({ output: { list: items(10) } }) };
    seedRun({ ...perItemGraph(), maxRunTokens: 1000 });
    await advanceRun("run1", d.deps);
    expect(d.ran).toHaveLength(3); // 500, 1000, 1500 > 1000
    expect(runs.get("run1")).toMatchObject({ state: "failed", inputTokens: 1200, outputTokens: 300 });
  });
});

describe("a card that stops the flow (Filter with nothing left)", () => {
  const filterNode = (id: string, fromIds: string[], x: number): FlowNode => ({ id, type: "filter", fromIds, config: { list: "{{trigger.items}}" }, ui: { label: "Fresh", position: { x, y: 0 } } });

  it("is Done, and the cards after it are Skipped with its reason while a sibling still runs", async () => {
    const { deps: d, ran } = deps(() => ({ output: { text: "x" } }));
    const stopper: CardImpl = { run: async () => ({ output: { items: [], count: 0, removed: 0 }, stop: "Nothing left after Fresh" }) };
    d.cards.filter = stopper;
    seedRun(graphOf(filterNode("fresh", ["trigger"], 1), agentNode("digest", ["fresh"], 2), agentNode("post", ["digest"], 3), agentNode("sibling", ["trigger"], 4)));
    await advanceRun("run1", d);
    const n = nodesOf();
    expect(n.fresh).toMatchObject({ status: "succeeded", stopReason: "Nothing left after Fresh" });
    expect(n.digest).toMatchObject({ status: "skipped", skippedReason: "Nothing left after Fresh" });
    expect(n.post).toMatchObject({ status: "skipped", skippedReason: "Nothing left after Fresh" });
    expect(ran).toEqual(["sibling"]);
    expect(runs.get("run1")).toMatchObject({ state: "succeeded", error: null });
  });

  it("lets the cards after it run when it passes items on", async () => {
    const { deps: d, ran } = deps(() => ({ output: { text: "x" } }));
    d.cards.filter = { run: async () => ({ output: { items: [1], count: 1, removed: 0 }}) };
    seedRun(graphOf(filterNode("fresh", ["trigger"], 1), agentNode("digest", ["fresh"], 2)));
    await advanceRun("run1", d);
    expect(ran).toEqual(["digest"]);
    expect(nodesOf().fresh.stopReason).toBeUndefined();
  });
});

describe("private tables", () => {
  const reader = agentNode("read", ["trigger"], 1, { tools: ["readChat"] });
  const save = (id: string, from: string[], x: number, tableId = "t1"): FlowNode => ({ id, type: "table", fromIds: from, config: { tableId, list: "{{trigger.items}}" }, ui: { label: id.toUpperCase(), position: { x, y: 0 } } });
  const fetchNode = (id: string, from: string[], x: number): FlowNode => ({ id, type: "fetch", fromIds: from, config: { url: "https://a.test" }, ui: { label: id.toUpperCase(), position: { x, y: 0 } } });
  const table = (id: string, privateFrom = "", userId = "u1") => dataTables.set(id, { id, userId, name: id === "t1" ? "Notes" : id === "t2" ? "Queue" : id, privateFrom });
  const leak = (name: string, from: string, card: string) => `“${name}” holds private data (it was filled from ${from}), and ${card} reaches the web after a card that reads it. Split them into two workflows, so a web page can't make it send that data out.`;

  it("a table saved to after a chat reader becomes private with the kind chats, and one saved to before it does not", async () => {
    table("t1");
    table("t3");
    await markPrivateTables("u1", graphOf(reader, save("keep", ["read"], 2), save("before", ["trigger"], 3, "t3")));
    expect(dataTables.get("t1")!.privateFrom).toBe("chats");
    expect(dataTables.get("t3")!.privateFrom).toBe("");
  });

  it("leaves a table alone when nothing before the Save reads private data, or the table is someone else's", async () => {
    table("t1", "", "u2");
    await markPrivateTables("u1", graphOf(reader, save("keep", ["read"], 2)));
    expect(dataTables.get("t1")!.privateFrom).toBe("");
    table("t1");
    await markPrivateTables("u1", graphOf(agentNode("a", ["trigger"], 1, { tools: ["calculator"] }), save("keep", ["a"], 2)));
    expect(dataTables.get("t1")!.privateFrom).toBe("");
  });

  it("copying through a second table keeps the flag: a Save card on a private table makes the next table private too", async () => {
    table("t1", "chats");
    table("t2");
    table("t3");
    // web search -> Save News (private) -> Save Queue -> Save Archive
    await markPrivateTables("u1", graphOf(save("a", ["trigger"], 1, "t1"), save("b", ["a"], 2, "t2"), save("c", ["b"], 3, "t3")));
    expect(dataTables.get("t2")!.privateFrom).toBe("chats");
    expect(dataTables.get("t3")!.privateFrom).toBe("chats");
  });

  it("refuses a card that reaches the web after a card that reads a private table, and names the kinds", async () => {
    table("t1", "chats");
    expect(await preflight("u1", graphOf(save("keep", ["trigger"], 1), fetchNode("page", ["keep"], 2)))).toEqual([{ nodeId: "page", message: leak("Notes", "chats", "PAGE") }]);
    table("t1", "chats,mcp");
    expect((await preflight("u1", graphOf(save("keep", ["trigger"], 1), fetchNode("page", ["keep"], 2))))[0].message).toContain("filled from chats and MCP");
  });

  it("counts the tables this graph is about to mark: a chat reader feeding Save T in one branch, Save T feeding the web in another", async () => {
    table("t1");
    table("t2");
    const g = graphOf(reader, save("one", ["read"], 2), save("two", ["trigger"], 3), fetchNode("page", ["two"], 4));
    g.nodes[3].config.tableId = "t1"; // Save "two" writes the same table as Save "one"
    expect((await preflight("u1", g)).map((e) => e.message)).toContain(leak("Notes", "chats", "PAGE"));
    // a copy into a second table inside one graph
    const copy = graphOf(reader, save("one", ["read"], 2), save("two", ["one"], 3, "t2"), fetchNode("page", ["two"], 4));
    expect((await preflight("u1", copy)).map((e) => e.message)).toContain(leak("Queue", "chats", "PAGE"));
  });

  it("allows the web before the private table, a branch beside it, and a public table", async () => {
    table("t1", "chats");
    expect(await preflight("u1", graphOf(fetchNode("page", ["trigger"], 1), save("keep", ["page"], 2)))).toEqual([]);
    expect(await preflight("u1", graphOf(save("keep", ["trigger"], 1), fetchNode("page", ["trigger"], 2)))).toEqual([]);
    table("t1");
    expect(await preflight("u1", graphOf(save("keep", ["trigger"], 1), fetchNode("page", ["keep"], 2)))).toEqual([]);
  });

  it("marks mcp and folder tables too, and keeps what the table already held", async () => {
    table("t1", "chats");
    table("t2");
    table("t3");
    const mcp: FlowNode = { id: "m", type: "mcpTool", fromIds: ["trigger"], config: { serverId: "s1", tool: "post" }, ui: { label: "M", position: { x: 1, y: 0 } } };
    const cli = agentNode("cli", ["trigger"], 1, { folder: "/p", model: "claude-code/default" });
    await markPrivateTables("u1", graphOf(mcp, save("a", ["m"], 2, "t1"), cli, save("b", ["cli"], 3, "t2"), save("c", ["trigger"], 4, "t3")));
    expect(dataTables.get("t1")!.privateFrom).toBe("chats,mcp");
    expect(dataTables.get("t2")!.privateFrom).toBe("folder");
    expect(dataTables.get("t3")!.privateFrom).toBe("");
  });

  it("marking is compare-and-set: a write by another run in between is re-read, not overwritten", async () => {
    table("t1");
    const { prisma } = await import("@/lib/db");
    const real = vi.mocked(prisma.dataTable.updateMany).getMockImplementation()!;
    vi.mocked(prisma.dataTable.updateMany).mockImplementationOnce((async (args: any) => {
      dataTables.get("t1")!.privateFrom = "mcp"; // the other run lands first
      return real(args);
    }) as never);
    await markPrivateTables("u1", graphOf(reader, save("keep", ["read"], 2)));
    expect(dataTables.get("t1")!.privateFrom).toBe("chats,mcp");
  });

  it("fails the start, not the table, when the mark keeps losing the race", async () => {
    table("t1");
    workflowRow = { id: "wf1", userId: "u1", name: "WF", graph: JSON.stringify(graphOf(reader, save("keep", ["read"], 2))) };
    vi.mocked(resolveAgentModel).mockResolvedValue({ name: "M", supportsTools: true } as never);
    const { prisma } = await import("@/lib/db");
    const real = vi.mocked(prisma.dataTable.updateMany).getMockImplementation()!;
    vi.mocked(prisma.dataTable.updateMany).mockResolvedValue({ count: 0 } as never);
    try {
      const r = await startRun("u1", "wf1");
      expect(r).toMatchObject({ ok: false, status: 409 });
      expect(runs.size).toBe(0);
    } finally {
      vi.mocked(prisma.dataTable.updateMany).mockImplementation(real);
    }
  });

  it("the per-card check fails closed when it cannot read the table", async () => {
    table("t1");
    seedRun(graphOf(save("keep", ["trigger"], 1)));
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.dataTable.findFirst).mockRejectedValueOnce(new Error("db down"));
    const { deps: d } = deps(() => ({ output: {} }));
    const ran: string[] = [];
    d.cards.table = { run: async () => (ran.push("table"), { output: { items: [] } }) };
    await advanceRun("run1", d);
    expect(ran).toEqual([]);
    expect(nodesOf().keep).toMatchObject({ status: "failed", error: "Couldn't check whether this table holds private data. Run it again." });
  });

  it("startRun marks the table, but only after the caps: a refused Run marks nothing", async () => {
    table("t1");
    workflowRow = { id: "wf1", userId: "u1", name: "WF", graph: JSON.stringify(graphOf(reader, save("keep", ["read"], 2))) };
    vi.mocked(resolveAgentModel).mockResolvedValue({ name: "M", supportsTools: true } as never);
    seedRun(graphOf(), { workflowId: "wf1" }, "busy"); // this workflow already has a run in progress
    const refused = await startRun("u1", "wf1");
    expect(refused).toMatchObject({ ok: false, status: 409 });
    expect(dataTables.get("t1")!.privateFrom).toBe("");
    runs.delete("busy");
    expect((await startRun("u1", "wf1")).ok).toBe(true);
    expect(dataTables.get("t1")!.privateFrom).toBe("chats");
  });

  it("checks again right before a Save card runs: a table marked after Start fails that card, and Resume gets the same check", async () => {
    table("t1"); // public when the run started
    const g = graphOf(save("keep", ["trigger"], 1), fetchNode("page", ["keep"], 2));
    seedRun(g);
    const { deps: d } = deps(() => ({ output: {} }));
    const ran: string[] = [];
    d.cards.table = { run: async () => (ran.push("table"), { output: { items: [] } }) };
    d.cards.fetch = { run: async () => (ran.push("fetch"), { output: {} }) };
    table("t1", "chats"); // another run marked it in the meantime
    await advanceRun("run1", d);
    const n = nodesOf();
    expect(ran).toEqual([]);
    expect(n.keep).toMatchObject({ status: "failed", error: leak("Notes", "chats", "PAGE") });
    expect(n.page).toMatchObject({ status: "skipped" });
    expect(runs.get("run1").state).toBe("failed");

    // Resume goes through the same per-card check
    expect((await resumeRun("u1", "run1")).ok).toBe(true);
    await advanceRun("run1", d);
    expect(ran).toEqual([]);
    expect(nodesOf().keep.status).toBe("failed");
  });
});

describe("Pick rows: waiting and continue (phase 3)", () => {
  const pickNode = (id: string, from: string[], x: number, config: Record<string, unknown> = {}): FlowNode => ({
    id,
    type: "pickRows",
    fromIds: from,
    config: { tableId: "t1", statuses: "new", maxPick: 2, setStatus: "picked", ...config },
    ui: { label: id.toUpperCase(), position: { x, y: 0 } },
  });
  const fetchNode = (id: string, from: string[], x: number): FlowNode => ({ id, type: "fetch", fromIds: from, config: { url: "https://a.test" }, ui: { label: id.toUpperCase(), position: { x, y: 0 } } });
  const WAIT = { tableId: "t1", tableName: "Jobs", statuses: ["new"], maxPick: 2, message: "Draft", sortBy: "", setStatus: "picked", offered: 3 };
  /** The Pick rows card as the real one answers when rows are on offer. */
  const waiter = (ran: string[]): CardImpl => ({ run: async (c) => (ran.push(c.node.id), { output: undefined, wait: WAIT }) });
  const withPick = (onAgent: (c: CardCtx) => any = () => ({ output: { text: "ok" } })) => {
    const d = deps(onAgent);
    const pickRan: string[] = [];
    d.deps.cards.pickRows = waiter(pickRan);
    d.deps.cards.fetch = { run: async () => ({ output: {} }) };
    return { ...d, pickRan };
  };
  const seedTable = (statuses = ["new"], privateFrom = "") => {
    dataTables.set("t1", { id: "t1", userId: "u1", name: "Jobs", privateFrom, statuses: JSON.stringify(statuses) });
    for (const [id, status] of [["r1", "new"], ["r2", "new"], ["r3", "new"]]) tableRows.set(id, { id, tableId: "t1", status, data: JSON.stringify({ title: `Job ${id}`, url: `https://x.test/${id}` }) });
  };
  const graph = () => graphOf(pickNode("pick", ["trigger"], 1), agentNode("draft", ["pick"], 2));
  const rowStatus = (id: string) => tableRows.get(id)!.status;

  it("a Pick rows card saves as Waiting and the run stops there, without an end time", async () => {
    const { deps: d, ran, pickRan } = withPick();
    seedRun(graph());
    await advanceRun("run1", d);
    expect(pickRan).toEqual(["pick"]);
    expect(ran).toEqual([]);
    expect(runs.get("run1")).toMatchObject({ state: "waiting", endedAt: null, error: null });
    expect(nodesOf().pick).toMatchObject({ status: "waiting", waiting: WAIT });
    expect(nodesOf().draft).toBeUndefined();
  });

  it("Continue hands the picked rows on, sets their status, and the run goes on from the next card", async () => {
    seedTable();
    const seen: unknown[] = [];
    const { deps: d, ran } = withPick((c) => (seen.push(c.tctx.nodes.pick), { output: { text: "drafted" } }));
    seedRun(graph());
    await advanceRun("run1", d);
    const r = await continueRun("u1", "run1", "pick", ["r2", "r1"]);
    expect(r).toEqual({ ok: true, runId: "run1" });
    expect(runs.get("run1")).toMatchObject({ state: "running", attempt: 1 });
    expect([rowStatus("r1"), rowStatus("r2"), rowStatus("r3")]).toEqual(["picked", "picked", "new"]);
    expect(JSON.parse(dataTables.get("t1")!.statuses!)).toEqual(["new", "picked"]); // the status is now one of the table's
    expect(nodesOf().pick).toMatchObject({ status: "succeeded", output: { count: 2 } });
    expect((nodesOf().pick.output as { items: Record<string, unknown>[] }).items.map((i) => [i._rowId, i.status, i.title])).toEqual([["r2", "picked", "Job r2"], ["r1", "picked", "Job r1"]]);

    await advanceRun("run1", d);
    expect(ran).toEqual(["draft"]);
    expect((seen[0] as { count: number }).count).toBe(2);
    expect(runs.get("run1").state).toBe("succeeded");
    expect(nodesOf().pick.status).toBe("succeeded");
  });

  it("rejects a row from another table, and nothing changes", async () => {
    seedTable();
    tableRows.set("other", { id: "other", tableId: "t2", status: "new", data: "{}" });
    const { deps: d } = withPick();
    seedRun(graph());
    await advanceRun("run1", d);
    const r = await continueRun("u1", "run1", "pick", ["r1", "other"]);
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(runs.get("run1").state).toBe("waiting");
    expect(nodesOf().pick.status).toBe("waiting");
    expect([rowStatus("r1"), rowStatus("other")]).toEqual(["new", "new"]);
    // the run can still be continued with good rows
    expect((await continueRun("u1", "run1", "pick", ["r1"])).ok).toBe(true);
  });

  it("rejects a row whose status is no longer offered, an id that does not exist, and more than maxPick", async () => {
    seedTable();
    const { deps: d } = withPick();
    seedRun(graph());
    await advanceRun("run1", d);
    tableRows.get("r3")!.status = "applied"; // moved on while the run was waiting
    expect(await continueRun("u1", "run1", "pick", ["r1", "r3"])).toMatchObject({ ok: false, status: 400 });
    expect(await continueRun("u1", "run1", "pick", ["nope"])).toMatchObject({ ok: false, status: 400 });
    expect(await continueRun("u1", "run1", "pick", ["r1", "r2", "r3"])).toMatchObject({ ok: false, status: 400, error: "Pick at most 2 rows." });
    expect(await continueRun("u1", "run1", "pick", "r1")).toMatchObject({ ok: false, status: 400 });
    expect(await continueRun("u1", "run1", "pick", [1])).toMatchObject({ ok: false, status: 400 });
    expect(runs.get("run1").state).toBe("waiting");
    expect([rowStatus("r1"), rowStatus("r3")]).toEqual(["new", "applied"]);
  });

  it("a second continue gets a 409, also when two arrive at once: only one wins", async () => {
    seedTable();
    const { deps: d } = withPick();
    seedRun(graph());
    await advanceRun("run1", d);
    const both = await Promise.all([continueRun("u1", "run1", "pick", ["r1"]), continueRun("u1", "run1", "pick", ["r2"])]);
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    expect(both.find((r) => !r.ok)).toMatchObject({ ok: false, status: 409 });
    expect((await continueRun("u1", "run1", "pick", ["r3"])).ok).toBe(false);
    expect(rowStatus("r3")).toBe("new");
    expect([rowStatus("r1"), rowStatus("r2")].filter((s) => s === "picked")).toHaveLength(1);
  });

  it("zero picks: the card is Done and the cards after it are Skipped with 'Nothing picked'", async () => {
    seedTable();
    const { deps: d, ran } = withPick();
    seedRun(graph());
    await advanceRun("run1", d);
    expect((await continueRun("u1", "run1", "pick", [])).ok).toBe(true);
    await advanceRun("run1", d);
    expect(ran).toEqual([]);
    expect(nodesOf().pick).toMatchObject({ status: "succeeded", stopReason: "Nothing picked", output: { items: [], count: 0 } });
    expect(nodesOf().draft).toMatchObject({ status: "skipped", skippedReason: "Nothing picked" });
    expect(runs.get("run1").state).toBe("succeeded");
    expect([rowStatus("r1"), rowStatus("r2"), rowStatus("r3")]).toEqual(["new", "new", "new"]);
  });

  it("only the owner's waiting run, and only the waiting card, can be continued", async () => {
    seedTable();
    const { deps: d } = withPick();
    seedRun(graph());
    await advanceRun("run1", d);
    expect(await continueRun("u2", "run1", "pick", ["r1"])).toMatchObject({ ok: false, status: 404 });
    expect(await continueRun("u1", "missing", "pick", [])).toMatchObject({ ok: false, status: 404 });
    expect(await continueRun("u1", "run1", "draft", [])).toMatchObject({ ok: false, status: 409 });
    expect(runs.get("run1").state).toBe("waiting");
    // not a waiting run at all
    seedRun(graph(), { state: "failed" }, "run2");
    expect(await continueRun("u1", "run2", "pick", [])).toMatchObject({ ok: false, status: 409 });
  });

  it("Cancel while waiting ends the run as Cancelled, and it can no longer be continued", async () => {
    seedTable();
    const { deps: d } = withPick();
    seedRun(graph());
    await advanceRun("run1", d);
    expect(await cancelRun("u1", "run1")).toBe(true);
    expect(runs.get("run1")).toMatchObject({ state: "cancelled" });
    expect(await continueRun("u1", "run1", "pick", ["r1"])).toMatchObject({ ok: false, status: 409 });
    expect(rowStatus("r1")).toBe("new");
  });

  it("Continue obeys the cap of two running runs", async () => {
    seedTable();
    const { deps: d } = withPick();
    seedRun(graph());
    await advanceRun("run1", d);
    seedRun(graphOf(), { workflowId: "wf2" }, "busy1");
    seedRun(graphOf(), { workflowId: "wf3" }, "busy2");
    expect(await continueRun("u1", "run1", "pick", ["r1"])).toMatchObject({ ok: false, status: 429 });
    expect(runs.get("run1").state).toBe("waiting");
  });

  it("an interrupted run reruns only the interrupted card: finished cards keep their output", async () => {
    const { deps: d, ran, pickRan } = withPick();
    // trigger and "a" finished; the server stopped while the Pick rows card was starting
    const g = graphOf(agentNode("a", ["trigger"], 1), pickNode("pick", ["a"], 2), agentNode("draft", ["pick"], 3));
    seedRun(g, {
      state: "interrupted",
      endedAt: new Date(),
      nodes: JSON.stringify({ trigger: { status: "succeeded", output: {} }, a: { status: "succeeded", output: { text: "kept" } }, pick: { status: "running", startedAt: "2026-11-09T10:00:00.000Z" } }),
    });
    expect((await resumeRun("u1", "run1")).ok).toBe(true);
    await advanceRun("run1", d);
    expect(ran).toEqual([]); // "a" was not run again
    expect(pickRan).toEqual(["pick"]);
    expect(nodesOf().a.output).toEqual({ text: "kept" });
    expect(runs.get("run1").state).toBe("waiting");
  });

  it("a pick that already happened is not asked for again when a later card fails and the run is resumed", async () => {
    seedTable();
    let fail = true;
    const { deps: d, ran, pickRan } = withPick(() => {
      if (fail) throw new Error("model blew up");
      return { output: { text: "ok" } };
    });
    seedRun(graph());
    await advanceRun("run1", d);
    await continueRun("u1", "run1", "pick", ["r1"]);
    await advanceRun("run1", d);
    expect(runs.get("run1").state).toBe("failed");
    fail = false;
    expect((await resumeRun("u1", "run1")).ok).toBe(true);
    await advanceRun("run1", d);
    expect(pickRan).toEqual(["pick"]); // once
    expect(ran).toEqual(["draft", "draft"]);
    expect(runs.get("run1").state).toBe("succeeded");
  });

  it("the real Pick rows card: waits when rows are on offer, stops when none are, and fails on a missing table", async () => {
    seedTable();
    const { deps: d, ran } = withPick();
    d.cards.pickRows = pickRowsCard;
    seedRun(graph());
    await advanceRun("run1", d);
    expect(runs.get("run1").state).toBe("waiting");
    expect(nodesOf().pick.waiting).toEqual({ tableId: "t1", tableName: "Jobs", statuses: ["new"], maxPick: 2, message: "", sortBy: "", setStatus: "picked", offered: 3 });

    for (const r of tableRows.values()) r.status = "applied";
    seedRun(graph(), {}, "run2");
    await advanceRun("run2", d);
    expect(nodesOf("run2").pick).toMatchObject({ status: "succeeded", stopReason: "No rows to pick in “Jobs”" });
    expect(nodesOf("run2").draft.status).toBe("skipped");
    expect(runs.get("run2").state).toBe("succeeded");

    dataTables.clear();
    seedRun(graph(), {}, "run3");
    await advanceRun("run3", d);
    expect(nodesOf("run3").pick).toMatchObject({ status: "failed", error: "Table not found" });
    expect(ran).toEqual([]);
  });

  describe("on a private table", () => {
    const leak = (from: string, card: string) => `“Jobs” holds private data (it was filled from ${from}), and ${card} reaches the web after a card that reads it. Split them into two workflows, so a web page can't make it send that data out.`;

    it("Run refuses a web card after a Pick rows card on a private table, as after a Save card, and names the kinds", async () => {
      seedTable(["new"], "chats");
      const g = graphOf(pickNode("pick", ["trigger"], 1), fetchNode("page", ["pick"], 2));
      expect(await preflight("u1", g)).toEqual([{ nodeId: "page", message: leak("chats", "PAGE") }]);
      // Job boards is the open web too
      const jobs: FlowNode = { id: "jobs", type: "jobBoards", fromIds: ["pick"], config: { boards: "jobs.lever.co/x" }, ui: { label: "JOBS", position: { x: 3, y: 0 } } };
      expect((await preflight("u1", graphOf(pickNode("pick", ["trigger"], 1), jobs))).map((e) => e.message)).toEqual([leak("chats", "JOBS")]);
      // a branch beside it, or a public table, is fine
      expect(await preflight("u1", graphOf(pickNode("pick", ["trigger"], 1), fetchNode("page", ["trigger"], 2)))).toEqual([]);
      seedTable(["new"], "");
      expect(await preflight("u1", g)).toEqual([]);
    });

    it("Run counts what this graph puts in the table: a chat reader feeding Save, then Pick rows, then the web", async () => {
      seedTable();
      const reader = agentNode("read", ["trigger"], 1, { tools: ["readChat"] });
      const save: FlowNode = { id: "keep", type: "table", fromIds: ["read"], config: { tableId: "t1", list: "{{read.items}}" }, ui: { label: "KEEP", position: { x: 2, y: 0 } } };
      const g = graphOf(reader, save, pickNode("pick", ["keep"], 3), fetchNode("page", ["pick"], 4));
      expect((await preflight("u1", g)).map((e) => e.message)).toContain(leak("chats", "PAGE"));
    });

    it("a table that is private after Run started fails the card before it waits, and no web card runs", async () => {
      seedTable(["new"], "");
      const { deps: d, pickRan } = withPick();
      const web: string[] = [];
      d.cards.fetch = { run: async () => (web.push("fetch"), { output: {} }) };
      seedRun(graphOf(pickNode("pick", ["trigger"], 1), fetchNode("page", ["pick"], 2)));
      dataTables.get("t1")!.privateFrom = "chats"; // another run marked it in the meantime
      await advanceRun("run1", d);
      expect(pickRan).toEqual([]);
      expect(web).toEqual([]);
      expect(nodesOf().pick).toMatchObject({ status: "failed", error: leak("chats", "PAGE") });
      expect(nodesOf().page.status).toBe("skipped");
      expect(runs.get("run1").state).toBe("failed");
    });

    it("Continue checks again: a table marked while the run waited fails the run, and no row changes", async () => {
      seedTable(["new"], "");
      const { deps: d } = withPick();
      seedRun(graphOf(pickNode("pick", ["trigger"], 1), fetchNode("page", ["pick"], 2)));
      await advanceRun("run1", d);
      expect(runs.get("run1").state).toBe("waiting");
      dataTables.get("t1")!.privateFrom = "chats";
      const r = await continueRun("u1", "run1", "pick", ["r1"]);
      expect(r).toMatchObject({ ok: false, status: 409, error: leak("chats", "PAGE") });
      expect(runs.get("run1")).toMatchObject({ state: "failed" });
      expect(nodesOf().pick).toMatchObject({ status: "failed", error: leak("chats", "PAGE") });
      expect(rowStatus("r1")).toBe("new");
    });
  });
});
