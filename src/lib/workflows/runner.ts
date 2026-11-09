import { prisma } from "@/lib/db";
import { CARDS, type CardImpl, type CardOutcome } from "./cards";
import { cliProviderForModel } from "@/lib/cliProviders";
import { resolveAgentModel, resolveMcpTools } from "./cards/agent";
import { ownedEnabledServer } from "./cards/mcpTool";
import { canUseHostTools, HOST_TOOLS_REFUSED } from "@/lib/hostAccess";
import { CATALOG, DEFAULT_MAX_ITEMS, MAX_ITEMS_LIMIT, OUTPUT_CAP_BYTES, parseConfig } from "./catalog";
import { kindsText, parseKinds, joinKinds, planKinds, privateTableMessage, webAfter, type PrivateKind } from "./privacy";
import {
  checkGraph,
  parseGraph,
  topoOrder,
  validateStructure,
  type CardRun,
  type FlowNode,
  type RunState,
  type WorkflowGraph,
} from "./graph";
import { normalizeRepo } from "./templates";
import { renderTemplate, type TemplateContext } from "./template";

export const RUN_LIMIT_MS = 30 * 60_000;
export const HEARTBEAT_MS = 15_000;
export const STALE_MS = 60_000;
export const SAVE_EVERY_MS = 2_000;
const MAX_RUNS_KEPT = 50;
const MAX_RUNNING_PER_USER = 2;

export interface RunnerDeps {
  cards: Record<string, CardImpl>;
}
const defaultDeps: RunnerDeps = { cards: CARDS };

/** Runs active in this process. On globalThis so a dev hot reload does not lose track of them. */
interface ActiveRun {
  ctrl: AbortController;
  /** The `attempt` this loop was started for; a Resume bumps it and the older loop is told to stop. */
  attempt: number;
  /** Set by shutdown: the loop returns without a final save, so the run goes stale and becomes Interrupted. */
  stopping: boolean;
}
const g = globalThis as unknown as { __workflowRuns?: Map<string, ActiveRun>; __workflowSignals?: boolean; __workflowStopping?: boolean };
const active = (g.__workflowRuns ??= new Map<string, ActiveRun>());

/** Aborts every run active in this process and keeps them from saving again. Also called by the signal handlers. */
export function stopAllRuns(): void {
  g.__workflowStopping = true; // an after() that starts later returns at once too
  for (const a of active.values()) {
    a.stopping = true;
    a.ctrl.abort();
  }
}

/**
 * `next start` waits for pending after() callbacks on SIGINT/SIGTERM, so a long run would hold the shutdown up.
 * This stops our runs at once; Next's own handler is left alone (we add a listener, never exit or remove one) and
 * still closes the server. If ours is the only listener, the signal is raised again so the process still exits.
 */
function registerShutdown(): void {
  if (g.__workflowSignals) return;
  g.__workflowSignals = true;
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      stopAllRuns();
      if (process.listenerCount(sig) === 0) process.kill(process.pid, sig);
    });
  }
}

/** For tests: a process that stopped its runs can run again. */
export function resetShutdownForTests(): void {
  g.__workflowStopping = false;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A card output kept under 200 KB: a list in `items` is cut, with `truncated: true`; anything else big is replaced. */
export function capOutput(output: unknown): unknown {
  const size = (v: unknown) => JSON.stringify(v)?.length ?? 0;
  if (size(output) <= OUTPUT_CAP_BYTES) return output;
  if (isObject(output) && Array.isArray(output.items)) {
    let items = output.items;
    while (items.length > 1 && size({ ...output, items, truncated: true }) > OUTPUT_CAP_BYTES) items = items.slice(0, Math.ceil(items.length / 2));
    return { ...output, items, truncated: true };
  }
  if (typeof output === "string") return output.slice(0, OUTPUT_CAP_BYTES);
  if (isObject(output)) {
    // One long text field (an agent's report): cut the longest string until the whole fits, after JSON escaping.
    const cut: Record<string, unknown> = { ...output, truncated: true };
    for (let i = 0; i < 40 && size(cut) > OUTPUT_CAP_BYTES; i++) {
      const longest = Object.entries(cut).filter(([, v]) => typeof v === "string").sort((a, b) => (b[1] as string).length - (a[1] as string).length)[0];
      if (!longest) break;
      cut[longest[0]] = (longest[1] as string).slice(0, Math.floor((longest[1] as string).length * 0.8));
    }
    if (size(cut) <= OUTPUT_CAP_BYTES) return cut;
  }
  return { truncated: true };
}

/** Marks `running` runs with no heartbeat for 60 s as interrupted. Runs wherever a run is read. */
export async function sweepOrphans(userId: string, now = Date.now()): Promise<number> {
  const r = await prisma.workflowRun.updateMany({
    where: { userId, state: "running", heartbeatAt: { lt: new Date(now - STALE_MS) } },
    data: { state: "interrupted", endedAt: new Date(now) },
  });
  return r.count;
}

function skipReason(graph: WorkflowGraph, nodes: Record<string, CardRun>, blockerId: string): string {
  const blocker = nodes[blockerId];
  const label = graph.nodes.find((n) => n.id === blockerId)?.ui.label ?? blockerId;
  if (blocker?.status === "succeeded" && blocker.stopReason) return blocker.stopReason;
  if (blocker?.status === "skipped") return blocker.skippedReason ?? `${label} was skipped`;
  if (blocker?.status === "failed") return `${label} failed`;
  return `${label} did not run`;
}

interface ItemCtx {
  impl: CardImpl;
  base: Parameters<CardImpl["run"]>[0];
  onProgress: (patch: Partial<CardRun>) => void;
  /** Items already done in an earlier attempt of this card. */
  resume?: CardRun["partial"];
  /** Run tokens spent before this card, and the cap. */
  tokens: { used: number; max: number };
}

type Usage = { inputTokens: number; outputTokens: number };
/** An error that still reports the tokens the card spent before it failed. */
const failWith = (msg: string, usage: Usage) => Object.assign(new Error(msg), { usage });

/** Runs a per-item card: the Items list, capped, with the card's own concurrency. Finished items are checkpointed. */
async function runItems({ impl, base, onProgress, resume, tokens }: ItemCtx): Promise<CardOutcome> {
  const { config, tctx, signal } = base;
  const r = renderTemplate(String(config.items ?? ""), tctx);
  if (!Array.isArray(r.value)) throw new Error("Items must be a list");
  const max = Math.min(Number(config.maxItems) || DEFAULT_MAX_ITEMS, MAX_ITEMS_LIMIT);
  const list = r.value.slice(0, max);
  const warnings: string[] = [];
  if (r.value.length > list.length) warnings.push(`Ran on the first ${list.length} of ${r.value.length} items`);
  if (list.length === 0) return { output: { items: [], count: 0, failed: 0 }, skip: "No items", warnings };

  // A resume keeps the items that finished before the stop, as long as the list is the same size.
  const prior = resume && resume.total === list.length ? resume : undefined;
  const results: (Record<string, unknown> | undefined)[] = new Array(list.length);
  const saved: Record<string, Record<string, unknown>> = { ...(prior?.results ?? {}) };
  for (const [k, v] of Object.entries(saved)) results[Number(k)] = v;
  const usage: Usage = { ...(prior?.usage ?? { inputTokens: 0, outputTokens: 0 }) };
  const itemErrors: { index: number; error: string }[] = [];
  let done = Object.keys(saved).length;
  let failed = 0;
  let next = 0;
  let overBudget = false;
  let log: CardOutcome["log"];
  const workers = Array.from({ length: Math.max(1, Math.min(impl.concurrency?.(base) ?? 1, list.length)) }, async () => {
    while (next < list.length && !signal.aborted && !overBudget) {
      const i = next++;
      if (results[i] !== undefined) continue;
      if (tokens.used + usage.inputTokens + usage.outputTokens > tokens.max) {
        overBudget = true;
        break;
      }
      try {
        const o = await impl.run({ ...base, tctx: { ...tctx, item: list[i], index: i + 1 } });
        results[i] = { ...(isObject(list[i]) ? list[i] : {}), ...(isObject(o.output) ? o.output : { result: o.output }) };
        saved[i] = results[i]!;
        usage.inputTokens += o.usage?.inputTokens ?? 0;
        usage.outputTokens += o.usage?.outputTokens ?? 0;
        for (const w of o.warnings ?? []) if (warnings.length < 10 && !warnings.includes(w)) warnings.push(w);
        log = o.log ?? log;
      } catch (e) {
        failed++;
        const spent = (e as { usage?: Usage }).usage;
        usage.inputTokens += spent?.inputTokens ?? 0;
        usage.outputTokens += spent?.outputTokens ?? 0;
        if (itemErrors.length < 20) itemErrors.push({ index: i + 1, error: message(e) });
      }
      done++;
      // Too big to keep in the run row: the last checkpoint that fit stays as it was, rather than failing the save.
      const fits = JSON.stringify(saved).length <= OUTPUT_CAP_BYTES;
      const partial = { total: list.length, results: { ...saved }, usage: { ...usage } };
      onProgress({ items: { done, failed, total: list.length }, usage: { ...usage }, itemErrors: [...itemErrors], log, ...(fits ? { partial } : {}) });
    }
  });
  await Promise.all(workers);
  if (signal.aborted) throw failWith("Cancelled", usage);
  if (overBudget) throw failWith("Token limit for this run reached", usage);
  const items = results.filter((x): x is Record<string, unknown> => x !== undefined);
  if (items.length === 0) throw failWith(`Every item failed: ${itemErrors[0]?.error ?? "no result"}`, usage);
  return {
    output: { items, count: items.length, failed },
    warnings,
    usage,
    log,
    itemErrors,
    items: { done, failed, total: list.length },
  };
}

async function execCard(
  node: FlowNode,
  baseCtx: Omit<Parameters<CardImpl["run"]>[0], "node" | "config">,
  deps: RunnerDeps,
  onProgress: (patch: Partial<CardRun>) => void,
  extra: { resume?: CardRun["partial"]; tokens: { used: number; max: number } },
): Promise<CardRun> {
  const startedAt = new Date().toISOString();
  const impl = deps.cards[node.type];
  const { config } = parseConfig(node.type, node.config);
  try {
    if (!impl) throw new Error(`Unknown card type "${node.type}"`);
    const base = { ...baseCtx, node, config };
    const o = CATALOG[node.type].perItem && config.perItem === true ? await runItems({ impl, base, onProgress, resume: extra.resume, tokens: extra.tokens }) : await impl.run(base);
    return {
      status: o.skip ? "skipped" : "succeeded",
      startedAt,
      endedAt: new Date().toISOString(),
      output: capOutput(o.output),
      ...(o.skip ? { skippedReason: o.skip } : {}),
      ...(o.stop ? { stopReason: o.stop } : {}),
      ...(o.warnings?.length ? { warnings: o.warnings.slice(0, 10) } : {}),
      ...(o.usage ? { usage: o.usage } : {}),
      ...(o.log ? { log: o.log.slice(-20) } : {}),
      ...(o.items ? { items: o.items } : {}),
      ...(o.itemErrors?.length ? { itemErrors: o.itemErrors } : {}),
    };
  } catch (e) {
    const spent = (e as { usage?: Usage }).usage;
    return { status: "failed", startedAt, endedAt: new Date().toISOString(), error: message(e), ...(spent ? { usage: spent } : {}) };
  }
}

/**
 * Runs a `running` run from where it stands to its end, a pause or a failure. Used by Start, Resume and Continue.
 * Every card status change is saved, so a process that dies mid-run leaves a run that can resume.
 */
export async function advanceRun(runId: string, deps: RunnerDeps = defaultDeps): Promise<void> {
  // Shutting down: leave the run as saved. Its heartbeat goes stale, it becomes Interrupted, and Resume can pick it up.
  if (g.__workflowStopping) return;
  const run = await prisma.workflowRun.findUnique({ where: { id: runId }, include: { workflow: { select: { name: true } } } });
  if (!run || run.state !== "running") return;
  // A loop for this attempt is already going. One for an older attempt (a Resume raced it) is told to stop.
  const existing = active.get(runId);
  if (existing && existing.attempt >= run.attempt) return;
  existing?.ctrl.abort();

  registerShutdown();
  const ctrl = new AbortController();
  const entry: ActiveRun = { ctrl, attempt: run.attempt, stopping: false };
  active.set(runId, entry);
  // Every write names this loop's attempt, so a newer attempt's rows are never touched by an older loop.
  const mine = { id: runId, state: "running", attempt: run.attempt };
  let timedOut = false;
  const limit = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, RUN_LIMIT_MS);
  const beat = setInterval(() => {
    prisma.workflowRun
      .updateMany({ where: mine, data: { heartbeatAt: new Date() } })
      .then((r) => {
        if (r.count === 0) ctrl.abort(); // cancelled elsewhere, or a newer attempt took over
      })
      .catch((e) => console.error("[workflows] heartbeat failed:", message(e)));
  }, HEARTBEAT_MS);

  try {
    const graph = parseGraph(run.graph);
    const nodes: Record<string, CardRun> = JSON.parse(run.nodes || "{}");
    let inputTokens = run.inputTokens;
    let outputTokens = run.outputTokens;

    // Saves go one at a time, in order. A save that changes no row means the run was cancelled or superseded: stop.
    let chain: Promise<boolean> = Promise.resolve(true);
    const save = (extra: Record<string, unknown> = {}) =>
      (chain = chain
        .catch(() => true)
        .then(async () => {
          if (entry.stopping) return false; // shutting down: the run is left as last saved
          const r = await prisma.workflowRun.updateMany({
            where: mine,
            data: { nodes: JSON.stringify(nodes), heartbeatAt: new Date(), inputTokens, outputTokens, ...extra },
          });
          if (r.count === 0) ctrl.abort();
          return r.count > 0;
        }));
    // A progress save that fails is logged and the run goes on; the next save carries the same data. A final save is not soft.
    const saveSoft = () =>
      void save().catch((e) => console.error("[workflows] progress save failed:", message(e)));
    const finish = (state: RunState, error?: string) => save({ state, error: error ?? null, endedAt: new Date() });

    const startedAt = run.startedAt.toISOString();
    // A variable named "repo" may hold a full GitHub URL (the Explain a GitHub repo template); it is read as owner/name.
    const vars = Object.fromEntries(graph.vars.map((v) => [v.key, v.key === "repo" ? normalizeRepo(v.value) : v.value]));
    const outputs = (): Record<string, unknown> =>
      Object.fromEntries(Object.entries(nodes).filter(([, r]) => r.status === "succeeded").map(([id, r]) => [id, r.output]));
    let lastItemSave = 0;

    for (const node of topoOrder(graph)) {
      const have = nodes[node.id];
      if (have && (have.status === "succeeded" || have.status === "skipped" || have.status === "failed")) continue;
      const blocker = node.fromIds.find((id) => nodes[id]?.status !== "succeeded" || nodes[id].stopReason);
      if (blocker) {
        nodes[node.id] = { status: "skipped", skippedReason: skipReason(graph, nodes, blocker) };
        if (!(await save())) return;
        continue;
      }
      // Private tables are checked again right before the Save card runs: another run may have marked the table since
      // Start, and a Resume never went through the Start checks.
      if (node.type === "table") {
        // If the check itself fails, the card does not run: it cannot be shown that the table is safe to read.
        const blocked = await privateBlock(run.userId, graph, node).catch(() => "Couldn't check whether this table holds private data. Run it again.");
        if (blocked) {
          nodes[node.id] = { status: "failed", startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), error: blocked };
          if (!(await save())) return;
          continue;
        }
      }
      // A card cut off mid-way keeps the items it finished.
      const resume = have?.partial;
      nodes[node.id] = { status: "running", startedAt: new Date().toISOString(), ...(resume ? { partial: resume } : {}) };
      if (!(await save())) return;

      const tctx: TemplateContext = {
        nodes: outputs(),
        vars,
        run: { id: runId, date: startedAt.slice(0, 10), startedAt },
        workflow: { name: run.workflow.name },
      };
      const result = await execCard(
        node,
        { userId: run.userId, workflowId: run.workflowId, tctx, defaultModel: graph.defaultModel, signal: ctrl.signal },
        deps,
        (patch) => {
          // Item progress, at most every 2 s.
          nodes[node.id] = { ...nodes[node.id], ...patch };
          if (Date.now() - lastItemSave >= SAVE_EVERY_MS) {
            lastItemSave = Date.now();
            saveSoft();
          }
        },
        { resume, tokens: { used: inputTokens + outputTokens, max: graph.maxRunTokens } },
      );
      // Shutting down: leave the card as it was saved ("running"), no final write. The heartbeat stops,
      // the run turns Interrupted, and Resume picks it up.
      if (entry.stopping) return;
      nodes[node.id] = result;
      inputTokens += result.usage?.inputTokens ?? 0;
      outputTokens += result.usage?.outputTokens ?? 0;
      if (timedOut) {
        await finish("failed", "Run took longer than 30 minutes");
        return;
      }
      if (!(await save())) return;
      if (inputTokens + outputTokens > graph.maxRunTokens) {
        await finish("failed", "Token limit for this run reached");
        return;
      }
    }
    const failedCard = graph.nodes.find((n) => nodes[n.id]?.status === "failed");
    await finish(failedCard ? "failed" : "succeeded", failedCard ? `${failedCard.ui.label} failed: ${nodes[failedCard.id].error ?? ""}`.trim() : undefined);
  } catch (e) {
    if (!entry.stopping) {
      await prisma.workflowRun
        .updateMany({ where: mine, data: { state: "failed", error: message(e), endedAt: new Date() } })
        .catch(() => {});
    }
  } finally {
    clearInterval(beat);
    clearTimeout(limit);
    if (active.get(runId) === entry) active.delete(runId);
  }
}

export type StartResult =
  | { ok: true; runId: string }
  | { ok: false; status: 400 | 404 | 409 | 429; error: string; runId?: string; errors?: { nodeId: string; message: string }[] };

/** The two caps (6.9) shared by Start and Resume. */
async function checkCaps(userId: string, workflowId: string, exceptRunId?: string): Promise<StartResult | null> {
  const running = await prisma.workflowRun.count({ where: { userId, state: "running", ...(exceptRunId ? { id: { not: exceptRunId } } : {}) } });
  if (running >= MAX_RUNNING_PER_USER) return { ok: false, status: 429, error: "Two runs are already running. Wait or cancel one." };
  const busy = await prisma.workflowRun.findFirst({
    where: { workflowId, state: { in: ["running", "waiting"] }, ...(exceptRunId ? { id: { not: exceptRunId } } : {}) },
    select: { id: true },
  });
  if (busy) return { ok: false, status: 409, error: "This workflow already has a run in progress.", runId: busy.id };
  return null;
}

/** Everything that stops a run before it starts: strict checks, models, the target chat (6.1 steps 2 and 5). */
export async function preflight(userId: string, graph: WorkflowGraph): Promise<{ nodeId: string; message: string }[]> {
  const errors: { nodeId: string; message: string }[] = [];
  const add = (nodeId: string, msg: string) => {
    const same = errors.find((e) => e.message === msg);
    if (!same) errors.push({ nodeId, message: msg });
    else if (!same.nodeId) same.nodeId = nodeId; // the structure check does not know the card; the later check does
  };
  for (const m of validateStructure(graph)) add("", m);
  for (const i of checkGraph(graph)) if (!i.warning) add(i.nodeId, i.message);
  const tables = await tableKinds(userId, graph);
  const plan = planKinds(graph, new Map([...tables].map(([id, t]) => [id, t.kinds])));
  for (const n of graph.nodes) {
    const label = n.ui.label || n.id;
    if (n.type === "agent") {
      const modelId = String(n.config.model || graph.defaultModel);
      try {
        const model = await resolveAgentModel(userId, modelId);
        // Codex runs only inside a folder (whether the folder is usable is checked when the card runs).
        if (cliProviderForModel(modelId)?.needsFolder && !n.config.folder) add(n.id, `${label}: ${model.name} needs a working folder. Pick one in the card's settings, or pick another model.`);
        const mcpTools = Array.isArray(n.config.mcpTools) ? (n.config.mcpTools as string[]) : [];
        if (((Array.isArray(n.config.tools) && n.config.tools.length > 0) || mcpTools.length > 0) && !model.supportsTools) {
          add(n.id, `${label}: ${model.name} can't use tools. Untick the tools or pick another model.`);
        }
      } catch (e) {
        add(n.id, `${label}: ${message(e)}`);
      }
    }
    if (n.type === "table" && n.config.tableId) {
      const table = tables.get(String(n.config.tableId));
      if (!table) add(n.id, `${label}: that table no longer exists`);
      // A card on a private table (counting what this very graph is about to put in it) is a private-data reader:
      // no card that reaches the web may come after it.
      else {
        const kinds = plan.get(String(n.config.tableId)) ?? [];
        if (kinds.length > 0) for (const m of webAfter(graph, n.id, kinds)) add(m.id, privateTableMessage(table.name, kinds, m));
      }
    }
    const usesMcp = n.type === "mcpTool" || (n.type === "agent" && Array.isArray(n.config.mcpTools) && n.config.mcpTools.length > 0);
    if (usesMcp && !(await canUseHostTools(userId))) add(n.id, `${label}: ${HOST_TOOLS_REFUSED}`);
    else if (n.type === "agent" && usesMcp) {
      // Missing, disabled or foreign servers and vanished tools fail now, not halfway through the run.
      await resolveMcpTools(userId, n.config.mcpTools as string[]).catch((e) => add(n.id, `${label}: ${message(e)}`));
    }
    if (n.type === "mcpTool" && !(await ownedEnabledServer(userId, String(n.config.serverId ?? "")))) {
      add(n.id, `${label}: pick an MCP server that is turned on`);
    }
    if (n.type === "chatMessage" && n.config.chat && n.config.chat !== "new") {
      const chat = await prisma.conversation.findFirst({ where: { id: String(n.config.chat), userId }, select: { id: true } });
      if (!chat) add(n.id, `${label}: that chat no longer exists`);
    }
  }
  return errors;
}

/** The user's tables that the graph's Save cards point at: name and the kinds of private data each holds now. */
async function tableKinds(userId: string, graph: WorkflowGraph): Promise<Map<string, { name: string; kinds: PrivateKind[] }>> {
  const out = new Map<string, { name: string; kinds: PrivateKind[] }>();
  for (const id of new Set(graph.nodes.map((n) => (n.type === "table" ? String(n.config.tableId ?? "") : "")).filter(Boolean))) {
    const t = await prisma.dataTable.findFirst({ where: { id, userId }, select: { id: true, name: true, privateFrom: true } });
    if (t) out.set(id, { name: t.name, kinds: parseKinds(t.privateFrom) });
  }
  return out;
}

/**
 * A table that a Save card fills after a private-data reader (or after a card on a private table) becomes private for
 * good, with the kinds it took in. Later flows that read it are held to the same rule.
 */
export async function markPrivateTables(userId: string, graph: WorkflowGraph): Promise<void> {
  const tables = await tableKinds(userId, graph);
  const plan = planKinds(graph, new Map([...tables].map(([id, t]) => [id, t.kinds])));
  for (const [id, kinds] of plan) {
    // Compare-and-set on the value that was read, so two runs adding different kinds never overwrite each other.
    for (let attempt = 0; ; attempt++) {
      const row = await prisma.dataTable.findFirst({ where: { id, userId }, select: { privateFrom: true } });
      if (!row) break;
      const merged = joinKinds([...parseKinds(row.privateFrom), ...kinds]);
      if (merged === joinKinds(parseKinds(row.privateFrom))) break;
      const r = await prisma.dataTable.updateMany({ where: { id, userId, privateFrom: row.privateFrom }, data: { privateFrom: merged } });
      if (r.count > 0) break;
      if (attempt >= 4) throw new Error("A table is being changed by another run");
    }
  }
}

/** The refusal for a Save card whose table is private now (read again, so a mark made after Run started counts) with a web card after it. */
async function privateBlock(userId: string, graph: WorkflowGraph, node: FlowNode): Promise<string | null> {
  const tables = await tableKinds(userId, graph);
  const plan = planKinds(graph, new Map([...tables].map(([id, t]) => [id, t.kinds])));
  const id = String(node.config.tableId ?? "");
  const kinds = plan.get(id) ?? [];
  const web = kinds.length > 0 ? webAfter(graph, node.id, kinds)[0] : undefined;
  return web ? privateTableMessage(tables.get(id)!.name, kinds, web) : null;
}

/** Start (6.1). The caller then runs `after(() => advanceRun(runId))`. */
export async function startRun(userId: string, workflowId: string): Promise<StartResult> {
  const wf = await prisma.workflow.findFirst({ where: { id: workflowId, userId } });
  if (!wf) return { ok: false, status: 404, error: "Workflow not found" };
  let graph: WorkflowGraph;
  try {
    graph = parseGraph(wf.graph);
  } catch (e) {
    return { ok: false, status: 400, error: message(e), errors: [{ nodeId: "", message: message(e) }] };
  }
  const errors = await preflight(userId, graph);
  if (errors.length > 0) return { ok: false, status: 400, error: errors[0].message, errors };
  await sweepOrphans(userId);
  // ponytail: check-then-create, so two starts in the same instant could both pass; a unique partial index would close it.
  const capped = await checkCaps(userId, workflowId);
  if (capped) return capped;
  // After the caps: a Run that is refused marks nothing.
  try {
    await markPrivateTables(userId, graph);
  } catch (e) {
    return { ok: false, status: 409, error: `Couldn't mark the tables private (${message(e)}). Try again.` };
  }

  const run = await prisma.workflowRun.create({ data: { workflowId, userId, state: "running", graph: JSON.stringify(graph), nodes: "{}" } });
  const old = await prisma.workflowRun.findMany({ where: { workflowId }, orderBy: { startedAt: "desc" }, skip: MAX_RUNS_KEPT, select: { id: true } });
  if (old.length > 0) await prisma.workflowRun.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  return { ok: true, runId: run.id };
}

/** Resume (6.5): a failed or interrupted run goes back to `running` from its first card that did not succeed. */
export async function resumeRun(userId: string, runId: string): Promise<StartResult> {
  const run = await prisma.workflowRun.findFirst({ where: { id: runId, userId } });
  if (!run) return { ok: false, status: 404, error: "Run not found" };
  if (run.state !== "failed" && run.state !== "interrupted") return { ok: false, status: 409, error: "Only a failed or interrupted run can be resumed." };
  const capped = await checkCaps(userId, run.workflowId, runId);
  if (capped) return capped;
  // Cards that already succeeded keep their outputs; the failed or interrupted card and what it skipped start over.
  const nodes: Record<string, CardRun> = JSON.parse(run.nodes || "{}");
  // A per-item card keeps the items it finished (its `partial`) and runs only the rest.
  for (const [id, r] of Object.entries(nodes)) {
    if (r.status === "succeeded") continue;
    if (r.partial) nodes[id] = { status: "running", startedAt: r.startedAt, partial: r.partial };
    else delete nodes[id];
  }
  const r = await prisma.workflowRun.updateMany({
    where: { id: runId, userId, state: { in: ["failed", "interrupted"] } },
    // attempt + 1: any older loop's saves now match no row, so it stops.
    data: { state: "running", error: null, endedAt: null, heartbeatAt: new Date(), nodes: JSON.stringify(nodes), attempt: { increment: 1 } },
  });
  if (r.count === 0) return { ok: false, status: 409, error: "Another request already resumed this run." };
  return { ok: true, runId };
}

/** Cancel (6.6). Also stops the run at once when it is active in this process. */
export async function cancelRun(userId: string, runId: string): Promise<boolean> {
  const r = await prisma.workflowRun.updateMany({
    where: { id: runId, userId, state: { in: ["running", "waiting"] } },
    data: { state: "cancelled", endedAt: new Date() },
  });
  // Only when this user's row matched: another user's run id must not be aborted by a failed cancel.
  if (r.count > 0) active.get(runId)?.ctrl.abort();
  return r.count > 0;
}
