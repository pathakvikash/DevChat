"use client";

import { useEffect, useState, Fragment } from "react";
import { useSearchParams } from "next/navigation";
import AppShell, { SidebarToggleButton } from "@/app/components/AppShell";
import { Activity, RefreshCw, AlertTriangle, XCircle, CheckCircle2, Clock, DollarSign, Coins, Timer } from "lucide-react";

interface ToolCall {
  id: string;
  toolName: string;
  input: string | null;
  output: string | null;
  ok: boolean;
  latencyMs: number | null;
}

interface Trace {
  id: string;
  conversationId: string | null;
  model: string;
  provider: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number | null;
  latencyMs: number;
  firstTokenMs: number | null;
  steps: number | null;
  finishReason: string | null;
  status: string;
  errorMsg: string | null;
  inputChars: number | null;
  outputChars: number | null;
  createdAt: string;
  toolCalls: ToolCall[];
}

interface ObservabilityData {
  total: number;
  summary: {
    requests: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost: number | null;
    avgLatencyMs: number | null;
    avgFirstTokenMs: number | null;
    avgTotalTokens: number | null;
    avgCost: number | null;
    statusCounts: Record<string, number>;
  };
  byModel: {
    model: string;
    requests: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost: number | null;
    avgLatencyMs: number | null;
    avgTotalTokens: number | null;
    avgCost: number | null;
  }[];
  traces: Trace[];
}

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "\u2014";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtCost(c: number | null | undefined): string {
  if (c == null) return "\u2014";
  if (c === 0) return "$0";
  if (c < 0.01) return `$${c.toFixed(4)}`;
  return `$${c.toFixed(2)}`;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    success: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    truncated: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    aborted: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
    error: "bg-red-500/15 text-red-300 border-red-500/30",
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wide ${map[status] || map.success}`}>
      {status}
    </span>
  );
}

function Card({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="glass-card rounded-[var(--glass-radius-lg)] p-4">
      <div className="flex items-center gap-2 text-zinc-500 mb-1">
        {icon}
        <span className="text-[11px] uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-bold text-[var(--foreground)]">{value}</div>
      {sub && <div className="text-xs text-zinc-500 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function ObservabilityPage() {
  const [data, setData] = useState<ObservabilityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function load() {
    try {
      const res = await fetch("/api/observability");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const id = setTimeout(() => { load(); }, 0);
    return () => clearTimeout(id);
  }, []);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const s = data?.summary;

  const embed = useSearchParams().get("embed") === "1";

  const content = (
        <main className="text-[var(--foreground)] min-h-full">
          <div className="max-w-6xl mx-auto px-6 py-8">
            <div className="sticky top-0 z-10 bg-[var(--background)] -mt-8 pt-8 flex items-center justify-between gap-3 flex-wrap mb-6">
              <div className="flex items-center gap-3 min-w-0">
                {!embed && <SidebarToggleButton />}
                <Activity size={26} className="text-blue-400 shrink-0" />
                <div className="min-w-0">
                  <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-[var(--foreground)]">Observability</h1>
                  <p className="text-xs text-zinc-500">Per-request latency, token usage & estimated cost</p>
                </div>
              </div>
              <button
                onClick={() => { setLoading(true); load(); }}
                disabled={loading}
                className="shrink-0 flex items-center gap-2 glass-button text-zinc-300 rounded-[var(--glass-radius-md)] px-3 py-2 text-sm transition disabled:opacity-50"
              >
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                Refresh
              </button>
            </div>

            {error && (
              <div className="glass-card rounded-[var(--glass-radius-md)] border border-red-500/30 bg-red-500/10 text-red-300 px-4 py-3 mb-4 text-sm">
                Failed to load: {error}
              </div>
            )}

            {s && (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
                <Card icon={<Activity size={14} />} label="Requests" value={fmtTokens(s.requests)} />
                <Card icon={<Coins size={14} />} label="Tokens" value={fmtTokens(s.totalTokens)} sub={`${fmtTokens(s.promptTokens)} in \u00b7 ${fmtTokens(s.completionTokens)} out`} />
                <Card icon={<DollarSign size={14} />} label="Est. Cost" value={fmtCost(s.cost)} sub={s.avgCost != null ? `${fmtCost(s.avgCost)} avg` : undefined} />
                <Card icon={<Clock size={14} />} label="Avg Latency" value={fmtMs(s.avgLatencyMs)} />
                <Card icon={<Timer size={14} />} label="Avg TTFT" value={fmtMs(s.avgFirstTokenMs)} />
                <Card icon={<AlertTriangle size={14} />} label="Errors" value={String((s.statusCounts.error || 0) + (s.statusCounts.aborted || 0))} sub={`${s.statusCounts.error || 0} err \u00b7 ${s.statusCounts.aborted || 0} abort`} />
              </div>
            )}

            {data?.byModel && data.byModel.length > 0 && (
              <div className="glass-card rounded-[var(--glass-radius-lg)] p-4 mb-6 overflow-x-auto">
                <h2 className="text-sm font-semibold text-zinc-300 mb-3">By Model</h2>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-zinc-500 text-left">
                      <th className="px-2 py-1 font-medium">Model</th>
                      <th className="px-2 py-1 font-medium text-right">Reqs</th>
                      <th className="px-2 py-1 font-medium text-right">Tokens</th>
                      <th className="px-2 py-1 font-medium text-right">Avg tok</th>
                      <th className="px-2 py-1 font-medium text-right">Cost</th>
                      <th className="px-2 py-1 font-medium text-right">Avg lat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byModel.map((m) => (
                      <tr key={m.model} className="border-t border-[var(--glass-border)]">
                        <td className="px-2 py-1.5 text-zinc-200 font-mono text-xs truncate max-w-[200px]">{m.model}</td>
                        <td className="px-2 py-1.5 text-right text-zinc-400">{m.requests}</td>
                        <td className="px-2 py-1.5 text-right text-zinc-400">{fmtTokens(m.totalTokens)}</td>
                        <td className="px-2 py-1.5 text-right text-zinc-400">{m.avgTotalTokens != null ? fmtTokens(m.avgTotalTokens) : "\u2014"}</td>
                        <td className="px-2 py-1.5 text-right text-zinc-400">{fmtCost(m.cost)}</td>
                        <td className="px-2 py-1.5 text-right text-zinc-400">{fmtMs(m.avgLatencyMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="glass-card rounded-[var(--glass-radius-lg)] p-4 overflow-x-auto">
              <h2 className="text-sm font-semibold text-zinc-300 mb-3">Recent Requests</h2>
              {!data && loading && <div className="text-sm text-zinc-500 py-8 text-center">Loading\u2026</div>}
              {data && data.traces.length === 0 && (
                <div className="text-sm text-zinc-500 py-8 text-center">No requests recorded yet. Send a message to start tracing.</div>
              )}
              {data && data.traces.length > 0 && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-zinc-500 text-left">
                      <th className="px-2 py-1 font-medium">Time</th>
                      <th className="px-2 py-1 font-medium">Model</th>
                      <th className="px-2 py-1 font-medium">Status</th>
                      <th className="px-2 py-1 font-medium text-right">Latency</th>
                      <th className="px-2 py-1 font-medium text-right">TTFT</th>
                      <th className="px-2 py-1 font-medium text-right">Tokens</th>
                      <th className="px-2 py-1 font-medium text-right">Cost</th>
                      <th className="px-2 py-1 font-medium text-right">Tools</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.traces.map((t) => {
                      const isOpen = expanded.has(t.id);
                      return (
                        <Fragment key={t.id}>
                          <tr
                            onClick={() => toggle(t.id)}
                            className="border-t border-[var(--glass-border)] cursor-pointer hover:bg-[var(--glass-bg-hover)]"
                          >
                            <td className="px-2 py-1.5 text-zinc-500 text-xs whitespace-nowrap">
                              {new Date(t.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                            </td>
                            <td className="px-2 py-1.5 text-zinc-200 font-mono text-xs max-w-[180px] truncate">{t.model}</td>
                            <td className="px-2 py-1.5"><StatusBadge status={t.status} /></td>
                            <td className="px-2 py-1.5 text-right text-zinc-400">{fmtMs(t.latencyMs)}</td>
                            <td className="px-2 py-1.5 text-right text-zinc-400">{fmtMs(t.firstTokenMs)}</td>
                            <td className="px-2 py-1.5 text-right text-zinc-400">{fmtTokens(t.totalTokens)}</td>
                            <td className="px-2 py-1.5 text-right text-zinc-400">{fmtCost(t.cost)}</td>
                            <td className="px-2 py-1.5 text-right text-zinc-400">{t.toolCalls.length || "\u2014"}</td>
                          </tr>
                          {isOpen && (
                            <tr className="border-t border-[var(--glass-border)] bg-[var(--glass-bg)]">
                              <td colSpan={8} className="px-4 py-3">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-zinc-400 mb-3">
                                  <div>Steps: <span className="text-zinc-200">{t.steps ?? "\u2014"}</span></div>
                                  <div>Finish: <span className="text-zinc-200">{t.finishReason ?? "\u2014"}</span></div>
                                  <div>In chars: <span className="text-zinc-200">{t.inputChars ?? "\u2014"}</span></div>
                                  <div>Out chars: <span className="text-zinc-200">{t.outputChars ?? "\u2014"}</span></div>
                                </div>
                                {t.errorMsg && (
                                  <div className="flex items-center gap-2 text-red-300 text-xs mb-3">
                                    <XCircle size={14} /> {t.errorMsg}
                                  </div>
                                )}
                                {t.toolCalls.length > 0 ? (
                                  <div className="space-y-2">
                                    {t.toolCalls.map((tc) => (
                                      <div key={tc.id} className="rounded border border-[var(--glass-border)] p-2">
                                        <div className="flex items-center gap-2 text-xs mb-1">
                                          {tc.ok ? <CheckCircle2 size={12} className="text-emerald-400" /> : <XCircle size={12} className="text-red-400" />}
                                          <span className="font-mono text-zinc-200">{tc.toolName}</span>
                                          {tc.latencyMs != null && <span className="text-zinc-500">\u00b7 {fmtMs(tc.latencyMs)}</span>}
                                        </div>
                                        {tc.input && (
                                          <pre className="text-[11px] text-zinc-400 whitespace-pre-wrap break-all max-h-32 overflow-auto">in: {tc.input}</pre>
                                        )}
                                        {tc.output && (
                                          <pre className="text-[11px] text-zinc-400 whitespace-pre-wrap break-all max-h-32 overflow-auto">out: {tc.output}</pre>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="text-xs text-zinc-600">No tool calls.</div>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </main>
  );

  return embed ? content : <AppShell>{content}</AppShell>;
}
