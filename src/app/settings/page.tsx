"use client";

import { useEffect, useState, useMemo } from "react";
import { Trash2, Save, RotateCcw, Loader2, Cable, Database } from "lucide-react";
import Link from "next/link";
import AppShell, { SidebarToggleButton } from "@/app/components/AppShell";
import { fetchSettings as apiFetchSettings, saveSettings as apiSaveSettings, deleteSettings as apiDeleteSettings } from "@/app/hooks/useSettingsApi";
import { fetchModels as apiFetchModels } from "@/app/hooks/useModelsApi";
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

  // API key state (server-side storage)
  const [orDisplay, setOrDisplay] = useState<string | null>(null);
  const [nimDisplay, setNimDisplay] = useState<string | null>(null);
  const [orDraft, setOrDraft] = useState("");
  const [nimDraft, setNimDraft] = useState("");
  const [editingKey, setEditingKey] = useState<"openrouter" | "nvidia" | null>(null);

  const [defaultModel, setDefaultModel] = useState("");
  const [autoCompressThreshold, setAutoCompressThreshold] = useState(85);

  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modelsList, setModelsList] = useState<ModelInfo[]>([]);

  const modelGroups = useMemo(() => groupModelsByProvider(modelsList), [modelsList]);

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
      setOrDisplay(data.openrouterApiKey);
      setNimDisplay(data.nvidiaNimApiKey);
      setDefaultModel(data.defaultModel || "");
    } catch {}
    if (typeof window !== "undefined") {
      setAutoCompressThreshold(
        parseInt(localStorage.getItem(LOCAL_KEYS.autoCompressThreshold) || "85", 10),
      );
    }
  }

  useEffect(() => {
    if (editingKey === null) {
      setOrDraft("");
      setNimDraft("");
    }
  }, [editingKey]);

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
      const models = await apiFetchModels();
      setModelsList(models);
    } catch (error) {
      console.error("Failed to fetch models:", error);
    }
  }

  async function handleSave() {
    setSaving(true);

    const payload: Record<string, string> = {};
    if (editingKey === "openrouter" && orDraft) payload.openrouterApiKey = orDraft;
    if (editingKey === "nvidia" && nimDraft) payload.nvidiaNimApiKey = nimDraft;
    payload.defaultModel = defaultModel;

    if (Object.keys(payload).length > 0) {
      await apiSaveSettings(payload);
    }

    localStorage.setItem(LOCAL_KEYS.autoCompressThreshold, String(autoCompressThreshold));

    setEditingKey(null);
    setSaving(false);
    setSaved(true);
    fetchSettings();
  }

  async function handleClearSettings() {
    const toRemove: string[] = [];
    if (orDisplay) toRemove.push("openrouterApiKey");
    if (nimDisplay) toRemove.push("nvidiaNimApiKey");
    if (defaultModel) toRemove.push("defaultModel");
    if (toRemove.length > 0) {
      await apiDeleteSettings(toRemove as any);
    }

    setOrDisplay(null);
    setNimDisplay(null);
    setOrDraft("");
    setNimDraft("");
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

  return (
    <AppShell>
        <main className="text-[var(--foreground)] p-8">
          <div className="sticky top-0 z-10 bg-[var(--background)] -mt-8 pt-8 flex items-center justify-between gap-3 flex-wrap mb-8">
            <div className="flex items-center gap-3 min-w-0">
              <SidebarToggleButton />
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
            {/* API Keys */}
            <div className="glass-card rounded-[var(--glass-radius-xl)] p-6">
              <h2 className="text-xl font-bold mb-5">API Keys</h2>
              <p className="text-sm text-zinc-500 mb-5">
                Keys are stored encrypted on the server. Saved at the
                conversation level; pass in the chat body as a one-time override.
              </p>
              <div className="space-y-5">
                {/* OpenRouter */}
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    OpenRouter API Key
                  </label>
                  {editingKey === "openrouter" ? (
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={orDraft}
                        onChange={(e) => setOrDraft(e.target.value)}
                        placeholder="sk-or-..."
                        className="flex-1 min-w-0 glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm"
                        autoFocus
                      />
                      <button
                        onClick={() => setEditingKey(null)}
                        className="shrink-0 glass-button px-3 py-2 text-sm text-zinc-400 rounded-[var(--glass-radius-md)]"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0 truncate glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm font-mono text-zinc-400 select-all">
                        {orDisplay ? orDisplay : <span className="text-zinc-600">Not configured</span>}
                      </div>
                      {orDisplay ? (
                        <button
                          onClick={() => { setEditingKey("openrouter"); setOrDraft(""); }}
                          className="shrink-0 glass-button px-3 py-2 text-sm text-zinc-300 rounded-[var(--glass-radius-md)]"
                        >
                          Change
                        </button>
                      ) : (
                        <button
                          onClick={() => { setEditingKey("openrouter"); setOrDraft(""); }}
                          className="shrink-0 glass-button-primary px-3 py-2 text-sm text-white rounded-[var(--glass-radius-md)]"
                        >
                          Add
                        </button>
                      )}
                    </div>
                  )}
                  <p className="text-xs text-zinc-500 mt-1">
                    API key for OpenRouter gateway. Stored server-side, never exposed to the client.
                  </p>
                </div>

                {/* NVIDIA NIM */}
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    NVIDIA NIM API Key
                  </label>
                  {editingKey === "nvidia" ? (
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={nimDraft}
                        onChange={(e) => setNimDraft(e.target.value)}
                        placeholder="nvapi-..."
                        className="flex-1 min-w-0 glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm"
                        autoFocus
                      />
                      <button
                        onClick={() => setEditingKey(null)}
                        className="shrink-0 glass-button px-3 py-2 text-sm text-zinc-400 rounded-[var(--glass-radius-md)]"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0 truncate glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm font-mono text-zinc-400 select-all">
                        {nimDisplay ? nimDisplay : <span className="text-zinc-600">Not configured</span>}
                      </div>
                      {nimDisplay ? (
                        <button
                          onClick={() => { setEditingKey("nvidia"); setNimDraft(""); }}
                          className="shrink-0 glass-button px-3 py-2 text-sm text-zinc-300 rounded-[var(--glass-radius-md)]"
                        >
                          Change
                        </button>
                      ) : (
                        <button
                          onClick={() => { setEditingKey("nvidia"); setNimDraft(""); }}
                          className="shrink-0 glass-button-primary px-3 py-2 text-sm text-white rounded-[var(--glass-radius-md)]"
                        >
                          Add
                        </button>
                      )}
                    </div>
                  )}
                  <p className="text-xs text-zinc-500 mt-1">
                    API key for NVIDIA NIM hosted models. Stored server-side.
                  </p>
                </div>
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
    </AppShell>
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
