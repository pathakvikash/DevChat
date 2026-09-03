"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Trash2, Save, RotateCcw, Loader2, Cable, Database, ExternalLink, Search, Terminal, Copy, Check } from "lucide-react";
import Link from "next/link";
import AppShell, { SidebarToggleButton } from "@/app/components/AppShell";
import {
  fetchSettings as apiFetchSettings,
  saveSettings as apiSaveSettings,
  deleteSettings as apiDeleteSettings,
  detectProviders,
  importDetectedProviders,
  startPairing,
  type DetectedProvider,
  type PairingInfo,
  type ToolReportInfo,
} from "@/app/hooks/useSettingsApi";
import { fetchModelCatalog } from "@/app/hooks/useModelsApi";
import { PROVIDERS, type ProviderDef } from "@/lib/providers";
import type { ProviderStatus } from "@/lib/models";
import { downloadBlob } from "@/lib/utils/download";
import { groupModelsByProvider, type ModelInfo } from "@/app/components/conversation/types";

interface Analytics {
  totalConversations: number;
  totalMessages: number;
  totalTokens: number;
  modelUsage: Record<string, number>;
  estimatedCost: number;
}

const LOCAL_KEYS = {
  autoCompressThreshold: "vas:settings:auto_compress_threshold",
} as const;

export default function SettingsPage() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  // Provider API keys (server-side, encrypted). Display values are masked.
  const [keyDisplay, setKeyDisplay] = useState<Record<string, string | null>>({});
  const [envProviders, setEnvProviders] = useState<string[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null); // provider id
  const [keyDraft, setKeyDraft] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [savedCustomBaseUrl, setSavedCustomBaseUrl] = useState("");
  const [providerStatus, setProviderStatus] = useState<ProviderStatus[]>([]);

  // "Find providers on this machine": scan → review → import, nothing saved
  // until the user ticks items and confirms.
  const [detectionAvailable, setDetectionAvailable] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<DetectedProvider[] | null>(null);
  const [scanReport, setScanReport] = useState<ToolReportInfo[]>([]);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Hosted deployments can't see the user's machine, so "connect this
  // computer" hands them a one-line terminal command with a one-time code and
  // waits for keys to arrive.
  const [pairing, setPairing] = useState<PairingInfo | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pairingPoll = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => stopPairing(), []);

  const [defaultModel, setDefaultModel] = useState("");
  const [autoCompressThreshold, setAutoCompressThreshold] = useState(85);

  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modelsList, setModelsList] = useState<ModelInfo[]>([]);

  const modelGroups = useMemo(() => groupModelsByProvider(modelsList), [modelsList]);
  const cliReady = useMemo(
    () => providerStatus.filter((s) => s.kind === "cli" && s.configured),
    [providerStatus],
  );

  useEffect(() => {
    fetchSettings();
    fetchAnalytics();
    fetchModels();
  }, []);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 3000);
    return () => clearTimeout(timer);
  }, [saved]);

  async function fetchSettings() {
    try {
      const data = await apiFetchSettings();
      const display: Record<string, string | null> = {};
      for (const p of PROVIDERS) display[p.id] = (data[p.settingKey] as string | null) ?? null;
      setKeyDisplay(display);
      setEnvProviders(data.envProviders ?? []);
      setDetectionAvailable(!!data.detectionAvailable);
      const base = (data.customBaseUrl as string | null) ?? "";
      setCustomBaseUrl(base);
      setSavedCustomBaseUrl(base);
      setDefaultModel(data.defaultModel || "");
    } catch {}
    if (typeof window !== "undefined") {
      setAutoCompressThreshold(
        parseInt(localStorage.getItem(LOCAL_KEYS.autoCompressThreshold) || "85", 10),
      );
    }
  }

  async function fetchAnalytics() {
    try {
      const res = await fetch("/api/analytics");
      if (res.ok) {
        setAnalytics(await res.json());
      }
    } catch (error) {
      console.error("Failed to fetch analytics:", error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchModels() {
    try {
      const { models, providers } = await fetchModelCatalog();
      setModelsList(models);
      setProviderStatus(providers);
    } catch (error) {
      console.error("Failed to fetch models:", error);
    }
  }

  async function handleSave() {
    setSaving(true);

    const payload: Record<string, string> = {};
    const editing = PROVIDERS.find((p) => p.id === editingKey);
    if (editing && keyDraft.trim()) payload[editing.settingKey] = keyDraft.trim();
    const base = customBaseUrl.trim();
    if (base) payload.customBaseUrl = base;
    else if (savedCustomBaseUrl) await apiDeleteSettings(["customBaseUrl"]);
    payload.defaultModel = defaultModel;

    await apiSaveSettings(payload);

    localStorage.setItem(LOCAL_KEYS.autoCompressThreshold, String(autoCompressThreshold));

    setEditingKey(null);
    setSaving(false);
    setSaved(true);
    fetchSettings();
    fetchModels();
  }

  const candidateId = (c: DetectedProvider) => `${c.providerId}|${c.source}`;

  async function handleDetect() {
    setDetecting(true);
    setDetectError(null);
    try {
      const { candidates: found, report } = await detectProviders();
      setDetected(found);
      setScanReport(report);
      // Preselect providers that have no key yet; leave configured ones unticked.
      setSelected(new Set(found.filter((c) => !keyDisplay[c.providerId]).map(candidateId)));
    } catch (e) {
      setDetectError(e instanceof Error ? e.message : "Detection failed");
    } finally {
      setDetecting(false);
    }
  }

  async function handleImport() {
    if (!detected) return;
    const items = detected.filter((c) => selected.has(candidateId(c)));
    if (items.length === 0) return;
    setDetecting(true);
    try {
      await importDetectedProviders(items.map(({ providerId, source }) => ({ providerId, source })));
      setDetected(null);
      setSaved(true);
      await fetchSettings();
      await fetchModels();
    } catch (e) {
      setDetectError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setDetecting(false);
    }
  }

  function stopPairing() {
    if (pairingPoll.current) clearInterval(pairingPoll.current);
    pairingPoll.current = null;
    setPairing(null);
  }

  async function handleStartPairing() {
    setPairingError(null);
    try {
      const info = await startPairing();
      setPairing(info);
      const before = Object.values(keyDisplay).filter(Boolean).length;
      const startedAt = Date.now();
      if (pairingPoll.current) clearInterval(pairingPoll.current);
      pairingPoll.current = setInterval(async () => {
        if (Date.now() - startedAt > info.expiresInSeconds * 1000) {
          stopPairing();
          setPairingError("The pairing code expired. Click Connect again for a new one.");
          return;
        }
        try {
          const data = await apiFetchSettings();
          const now = PROVIDERS.filter((p) => data[p.settingKey]).length;
          if (now > before) {
            stopPairing();
            setSaved(true);
            await fetchSettings();
            await fetchModels();
          }
        } catch {
          // transient; keep polling
        }
      }, 3000);
    } catch (e) {
      setPairingError(e instanceof Error ? e.message : "Could not start pairing");
    }
  }

  async function copyCommand() {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable; the command is selectable
    }
  }

  async function handleClearSettings() {
    const toRemove: string[] = [];
    for (const p of PROVIDERS) if (keyDisplay[p.id]) toRemove.push(p.settingKey);
    if (savedCustomBaseUrl) toRemove.push("customBaseUrl");
    if (defaultModel) toRemove.push("defaultModel");
    if (toRemove.length > 0) {
      await apiDeleteSettings(toRemove);
    }

    setKeyDisplay({});
    setCustomBaseUrl("");
    setSavedCustomBaseUrl("");
    setKeyDraft("");
    setEditingKey(null);
    setDefaultModel("");
    setAutoCompressThreshold(85);
    localStorage.removeItem(LOCAL_KEYS.autoCompressThreshold);
    setSaved(true);
  }

  async function clearAllData() {
    if (!confirm("Delete all data? This cannot be undone.")) return;

    try {
      const res = await fetch("/api/conversations");
      if (!res.ok) throw new Error("Failed to fetch conversations");
      const conversations = await res.json();
      for (const conv of conversations) {
        const delRes = await fetch(`/api/conversations/${conv.id}`, { method: "DELETE" });
        if (!delRes.ok) {
          console.error(`Failed to delete conversation ${conv.id}: ${delRes.status}`);
        }
      }
      fetchAnalytics();
    } catch (error) {
      console.error("Failed to clear data:", error);
    }
  }

  const embed = useSearchParams().get("embed") === "1";

  const content = (
        <main className="text-[var(--foreground)] p-8">
          <div className="sticky top-0 z-10 bg-[var(--background)] -mt-8 pt-8 flex items-center justify-between gap-3 flex-wrap mb-8">
            <div className="flex items-center gap-3 min-w-0">
              {!embed && <SidebarToggleButton />}
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold">Settings & Analytics</h1>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 glass-button-primary text-white rounded-[var(--glass-radius-md)] px-5 py-2.5 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Save size={18} />
                )}
                {saving ? "Saving..." : "Save Settings"}
              </button>
              <button
                onClick={handleClearSettings}
                className="flex items-center gap-2 glass-button text-zinc-300 rounded-[var(--glass-radius-md)] px-5 py-2.5"
              >
                <RotateCcw size={18} />
                Clear
              </button>
            </div>
          </div>

          {saved && (
            <div className="mb-6 px-4 py-3 glass-card rounded-[var(--glass-radius-md)] border border-emerald-900/50 text-emerald-300 text-sm">
              Settings saved successfully.
            </div>
          )}

          <div className="space-y-8 max-w-4xl">
            {/* Providers */}
            <div className="glass-card rounded-[var(--glass-radius-xl)] p-6">
              <h2 className="text-xl font-bold mb-2">LLM Providers</h2>
              <p className="text-sm text-zinc-500 mb-5">
                Bring your own keys. They are stored encrypted on the server and only
                used for your requests. Any provider with a key shows up in the model
                picker with its live model list. Local Ollama is detected automatically.
              </p>
              <div className="space-y-5">
                {PROVIDERS.map((p) => (
                  <ProviderKeyRow
                    key={p.id}
                    provider={p}
                    display={keyDisplay[p.id] ?? null}
                    fromEnv={envProviders.includes(p.id)}
                    status={providerStatus.find((st) => st.id === p.id)}
                    editing={editingKey === p.id}
                    draft={keyDraft}
                    onDraft={setKeyDraft}
                    onEdit={() => { setEditingKey(p.id); setKeyDraft(""); }}
                    onCancel={() => setEditingKey(null)}
                    baseUrl={p.baseUrlSettingKey ? customBaseUrl : undefined}
                    onBaseUrl={p.baseUrlSettingKey ? setCustomBaseUrl : undefined}
                  />
                ))}
              </div>

              {/* Detect from this machine */}
              <div className="mt-6 pt-5 border-t border-zinc-800">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-zinc-200">Find providers on this machine</h3>
                    <p className="text-xs text-zinc-500 mt-1 max-w-xl">
                      {detectionAvailable
                        ? "Looks for API keys already saved by Codex CLI, Claude Code, Gemini CLI, OpenCode, bb and your shell profile. You review what was found and choose what to import. OAuth logins are never read."
                        : "This site can't see your computer, but a small script run in your terminal can. It finds API keys already saved by Codex CLI, Claude Code, Gemini CLI, OpenCode, bb and your shell profile, asks you about each one, and sends only the ones you approve here. OAuth logins are never read."}
                    </p>
                    {cliReady.length > 0 && (
                      <p className="text-xs text-emerald-400 mt-2 max-w-xl">
                        Ready now through installed tools:{" "}
                        {cliReady
                          .map((s) => `${s.label} (${s.modelCount} model${s.modelCount === 1 ? "" : "s"})`)
                          .join(", ")}
                        . Pick them in the model selector; DevChat runs the tool for you with its own login.
                      </p>
                    )}
                  </div>
                  {detectionAvailable ? (
                    <button
                      onClick={handleDetect}
                      disabled={detecting}
                      className="flex items-center gap-2 glass-button text-zinc-200 rounded-[var(--glass-radius-md)] px-4 py-2 text-sm disabled:opacity-50"
                    >
                      {detecting ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                      {detected ? "Scan again" : "Scan this machine"}
                    </button>
                  ) : !pairing ? (
                    <button
                      onClick={handleStartPairing}
                      className="flex items-center gap-2 glass-button-primary text-white rounded-[var(--glass-radius-md)] px-4 py-2 text-sm"
                    >
                      <Terminal size={16} />
                      Connect this computer
                    </button>
                  ) : null}
                </div>

                {pairingError && (
                  <p className="text-xs text-red-400 mt-3">{pairingError}</p>
                )}

                {pairing && (
                  <div className="mt-4 space-y-3">
                    <p className="text-sm text-zinc-300">
                      Run this in a terminal on your computer:
                    </p>
                    <div className="flex items-stretch gap-2">
                      <pre className="flex-1 min-w-0 overflow-x-auto glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-xs font-mono text-zinc-200 select-all">
                        {pairing.command}
                      </pre>
                      <button
                        onClick={copyCommand}
                        className="shrink-0 flex items-center gap-1.5 glass-button text-zinc-200 rounded-[var(--glass-radius-md)] px-3 text-sm"
                      >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                        {copied ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-zinc-500">
                      <span className="flex items-center gap-1.5">
                        <Loader2 size={12} className="animate-spin" />
                        Waiting for the script to finish. This page updates on its own. Code expires in 10 minutes.
                      </span>
                      <a href={pairing.scriptUrl} target="_blank" rel="noreferrer" className="hover:text-zinc-300 underline">
                        Read the script first
                      </a>
                      <button onClick={stopPairing} className="hover:text-zinc-300 underline">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {detectError && (
                  <p className="text-xs text-red-400 mt-3">{detectError}</p>
                )}

                {detected && detected.length === 0 && (
                  <p className="text-xs text-zinc-400 mt-3">
                    No reusable API keys found. Here is what each tool on this machine is doing:
                  </p>
                )}

                {detected && scanReport.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {scanReport
                      .filter((r) => r.status !== "absent")
                      .map((r) => (
                        <li key={r.tool} className="flex gap-3 text-xs">
                          <span
                            className={`shrink-0 w-24 font-medium ${
                              r.status === "keys"
                                ? "text-emerald-400"
                                : r.status === "oauth"
                                  ? "text-amber-400"
                                  : "text-zinc-400"
                            }`}
                          >
                            {r.tool}
                          </span>
                          <span className="text-zinc-500">{r.detail}</span>
                        </li>
                      ))}
                    {scanReport.some((r) => r.status === "absent") && (
                      <li className="text-xs text-zinc-600">
                        Not installed: {scanReport.filter((r) => r.status === "absent").map((r) => r.tool).join(", ")}
                      </li>
                    )}
                  </ul>
                )}

                {detected && detected.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {detected.map((c) => {
                      const id = candidateId(c);
                      const already = !!keyDisplay[c.providerId];
                      return (
                        <label
                          key={id}
                          className="flex items-center gap-3 glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(id)}
                            onChange={(e) => {
                              const next = new Set(selected);
                              if (e.target.checked) next.add(id); else next.delete(id);
                              setSelected(next);
                            }}
                            className="accent-blue-500"
                          />
                          <span className="font-medium text-zinc-200 w-32 shrink-0">{c.label}</span>
                          <span className="font-mono text-zinc-400 truncate">{c.maskedKey}</span>
                          <span className="text-xs text-zinc-500 truncate ml-auto">
                            {c.source}{already ? " · replaces saved key" : ""}
                          </span>
                        </label>
                      );
                    })}
                    <button
                      onClick={handleImport}
                      disabled={detecting || selected.size === 0}
                      className="mt-2 flex items-center gap-2 glass-button-primary text-white rounded-[var(--glass-radius-md)] px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Import {selected.size} selected
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Default Model */}
            <div className="glass-card rounded-[var(--glass-radius-xl)] p-6">
              <h2 className="text-xl font-bold mb-4">Default Model</h2>
              <p className="text-sm text-zinc-500 mb-3">
                Default model used when creating a new conversation. Stored server-side.
              </p>
              <select
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
                className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm"
              >
                <option value="">None (use per-conversation default)</option>
                {modelGroups.map((group) => (
                  <optgroup key={group.provider} label={group.provider}>
                    {group.models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <p className="text-xs text-zinc-500 mt-1">
                Default model for new conversations.
              </p>
            </div>

            {/* Auto-Compress Threshold */}
            <div className="glass-card rounded-[var(--glass-radius-xl)] p-6">
              <h2 className="text-xl font-bold mb-4">Auto-Compress</h2>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">
                  Compress at {autoCompressThreshold}% context usage
                </label>
                <input
                  type="range"
                  min={50}
                  max={99}
                  value={autoCompressThreshold}
                  onChange={(e) => setAutoCompressThreshold(Number(e.target.value))}
                  className="w-full accent-blue-500"
                />
                <div className="flex justify-between text-xs text-zinc-500 mt-1">
                  <span>50% (sooner)</span>
                  <span>99% (later)</span>
                </div>
                <p className="text-xs text-zinc-500 mt-2">
                  When the conversation reaches this percentage of the current
                  context window, older messages are summarized to free up space.
                </p>
              </div>
            </div>

            {/* MCP Servers */}
            <div className="glass-card rounded-[var(--glass-radius-xl)] p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold mb-1">MCP Servers</h2>
                  <p className="text-sm text-zinc-400">
                    Connect external tools via the Model Context Protocol.
                  </p>
                </div>
                <Link
                  href="/settings/mcp"
                  className="flex items-center gap-2 px-4 py-2 glass-button-primary text-white rounded-[var(--glass-radius-md)]"
                >
                  <Cable size={18} />
                  Manage
                </Link>
              </div>
            </div>

            {/* Dataset Export */}
            <div className="glass-card rounded-[var(--glass-radius-xl)] p-6">
              <h2 className="text-xl font-bold mb-4">Training Dataset Export</h2>
              <p className="text-sm text-zinc-400 mb-4">
                Export rated conversations for fine-tuning. Only assistant messages with
                thumbs up/down feedback are included.
              </p>
              <DatasetExportSection />
            </div>

            {/* Analytics Summary */}
            {loading ? (
              <p className="text-zinc-400">Loading analytics...</p>
            ) : analytics ? (
              <>
                <div className="glass-card rounded-[var(--glass-radius-xl)] p-6">
                  <h2 className="text-xl font-bold mb-6">Usage Statistics</h2>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <div className="text-zinc-400 text-sm">Total Chats</div>
                      <div className="text-2xl font-bold">{analytics.totalConversations}</div>
                    </div>
                    <div>
                      <div className="text-zinc-400 text-sm">Messages</div>
                      <div className="text-2xl font-bold">{analytics.totalMessages}</div>
                    </div>
                    <div>
                      <div className="text-zinc-400 text-sm">Tokens Used</div>
                      <div className="text-2xl font-bold">
                        {(analytics.totalTokens / 1000).toFixed(1)}K
                      </div>
                    </div>
                    <div>
                      <div className="text-zinc-400 text-sm">Est. Cost</div>
                      <div className="text-2xl font-bold">
                        ${analytics.estimatedCost.toFixed(3)}
                      </div>
                    </div>
                  </div>
                </div>

                {Object.keys(analytics.modelUsage).length > 0 && (
                  <div className="glass-card rounded-[var(--glass-radius-xl)] p-6">
                    <h2 className="text-xl font-bold mb-4">Model Usage</h2>
                    <div className="space-y-3">
                      {Object.entries(analytics.modelUsage).map(([model, tokens]) => (
                        <div key={model} className="flex items-center justify-between">
                          <span className="text-zinc-300">{model}</span>
                          <div className="flex items-center gap-4">
                            <div className="w-40 glass rounded-full h-2">
                              <div
                                className="bg-blue-600 h-2 rounded-full"
                                style={{
                                  width: `${(tokens / analytics.totalTokens) * 100}%`,
                                }}
                              />
                            </div>
                            <span className="text-zinc-400 text-sm w-20 text-right">
                              {((tokens / analytics.totalTokens) * 100).toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Danger Zone */}
                <div className="glass-card rounded-[var(--glass-radius-xl)] p-6 border-red-900/60">
                  <h2 className="text-xl font-bold text-red-400 mb-4">Danger Zone</h2>
                  <button
                    onClick={clearAllData}
                    className="flex items-center gap-2 glass-button-danger text-red-600 rounded-[var(--glass-radius-md)] px-4 py-2"
                  >
                    <Trash2 size={18} />
                    Clear All Data
                  </button>
                  <p className="text-sm text-zinc-400 mt-3">
                    This will permanently delete all conversations and messages.
                  </p>
                </div>

                {/* API Info */}
                <div className="glass-card rounded-[var(--glass-radius-xl)] p-6">
                  <h2 className="text-xl font-bold mb-4">API Endpoints</h2>
                  <div className="space-y-3 text-sm font-mono">
                    <div className="text-zinc-300">
                      <span className="text-green-400">GET</span> /api/conversations
                    </div>
                    <div className="text-zinc-300">
                      <span className="text-green-400">POST</span> /api/chat
                    </div>
                    <div className="text-zinc-300">
                      <span className="text-green-400">GET</span> /api/personas
                    </div>
                    <div className="text-zinc-300">
                      <span className="text-green-400">GET</span> /api/analytics
                    </div>
                    <div className="text-zinc-300">
                      <span className="text-green-400">GET</span> /api/search?q=query
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-zinc-400">Failed to load analytics</p>
            )}
          </div>
        </main>
  );

  return embed ? content : <AppShell>{content}</AppShell>;
}

function ProviderKeyRow({
  provider: p,
  display,
  fromEnv,
  status,
  editing,
  draft,
  onDraft,
  onEdit,
  onCancel,
  baseUrl,
  onBaseUrl,
}: {
  provider: ProviderDef;
  display: string | null;
  fromEnv: boolean;
  status?: ProviderStatus;
  editing: boolean;
  draft: string;
  onDraft: (v: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  baseUrl?: string;
  onBaseUrl?: (v: string) => void;
}) {
  const statusText = status?.error
    ? `Error: ${status.error}`
    : status?.configured
      ? `${status.modelCount} model${status.modelCount === 1 ? "" : "s"} available`
      : fromEnv
        ? "Configured by this deployment"
        : "Not configured";
  const statusColor = status?.error
    ? "text-red-400"
    : status?.configured
      ? "text-emerald-400"
      : "text-zinc-500";

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="block text-sm font-medium text-zinc-300">{p.label}</label>
        <span className={`text-xs ${statusColor}`}>{statusText}</span>
      </div>
      {onBaseUrl && (
        <input
          type="url"
          value={baseUrl ?? ""}
          onChange={(e) => onBaseUrl(e.target.value)}
          placeholder="Base URL, e.g. http://localhost:1234/v1 or https://api.groq.com/openai/v1"
          className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm mb-2"
        />
      )}
      {editing ? (
        <div className="flex gap-2">
          <input
            type="password"
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            placeholder={p.placeholder}
            className="flex-1 min-w-0 glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm"
            autoFocus
          />
          <button
            onClick={onCancel}
            className="shrink-0 glass-button px-3 py-2 text-sm text-zinc-400 rounded-[var(--glass-radius-md)]"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 truncate glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm font-mono text-zinc-400 select-all">
            {display ? display : (
              <span className="text-zinc-600">
                {fromEnv ? "Using server key" : "No key"}
              </span>
            )}
          </div>
          <button
            onClick={onEdit}
            className={`shrink-0 px-3 py-2 text-sm rounded-[var(--glass-radius-md)] ${
              display ? "glass-button text-zinc-300" : "glass-button-primary text-white"
            }`}
          >
            {display ? "Change" : "Add"}
          </button>
        </div>
      )}
      {p.docsUrl && (
        <a
          href={p.docsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 mt-1"
        >
          Get a key <ExternalLink size={10} />
        </a>
      )}
    </div>
  );
}

function DatasetExportSection() {
  const [format, setFormat] = useState<"sharegpt" | "jsonl">("sharegpt");
  const [minRating, setMinRating] = useState("1");
  const [model, setModel] = useState("");
  const [limit, setLimit] = useState("1000");
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ format, limit });
      if (minRating) params.set("minRating", minRating);
      if (model) params.set("model", model);
      const res = await fetch(`/api/dataset?${params.toString()}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const ext = format === "sharegpt" ? ".json" : ".jsonl";
      downloadBlob(blob, `vas-dataset${ext}`);
    } catch (e) {
      console.error("Dataset export error:", e);
      alert("Export failed. Check console for details.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1">Format</label>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as "sharegpt" | "jsonl")}
            className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm"
          >
            <option value="sharegpt">ShareGPT (Axolotl/LLaMA-Factory)</option>
            <option value="jsonl">JSONL (simple)</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1">Min Rating</label>
          <select
            value={minRating}
            onChange={(e) => setMinRating(e.target.value)}
            className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm"
          >
            <option value="1">Thumbs up only</option>
            <option value="-1">All rated (thumbs up & down)</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1">
            Model filter <span className="text-zinc-500">(optional)</span>
          </label>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. ollama/qwen3.5"
            className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1">Max entries</label>
          <input
            type="number"
            min={1}
            max={10000}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm"
          />
        </div>
      </div>
      <button
        onClick={handleExport}
        disabled={exporting}
        className="flex items-center gap-2 glass-button-primary text-white rounded-[var(--glass-radius-md)] px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Database size={16} />
        {exporting ? "Exporting..." : "Export Dataset"}
      </button>
      <p className="text-xs text-zinc-500">
        Only messages with thumbs up/down ratings are included. Use the thumbs
        buttons on assistant messages to rate them first.
      </p>
    </div>
  );
}
