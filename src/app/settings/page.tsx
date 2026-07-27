"use client";

import { useEffect, useState, useMemo } from "react";
import { Trash2, BookOpen, Save, RotateCcw, Loader2, Cable, Database } from "lucide-react";
import Link from "next/link";
import Sidebar from "@/app/components/Sidebar";
import { getClientApiKeys } from "@/lib/apiKeys";

interface Analytics {
  totalConversations: number;
  totalMessages: number;
  totalTokens: number;
  modelUsage: Record<string, number>;
  estimatedCost: number;
}

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
}

interface ModelGroup {
  provider: string;
  models: ModelInfo[];
}

const STORAGE_KEYS = {
  openrouterApiKey: "vas:settings:openrouter_api_key",
  nvidiaNimApiKey: "vas:settings:nvidia_nim_api_key",
  nvidiaNimBaseUrl: "vas:settings:nvidia_nim_base_url",
  ollamaHost: "vas:settings:ollama_host",
  defaultModel: "vas:settings:default_model",
  autoCompressThreshold: "vas:settings:auto_compress_threshold",
} as const;

function groupModelsByProvider(models: ModelInfo[]): ModelGroup[] {
  const grouped = models.reduce<Record<string, ModelInfo[]>>((acc, model) => {
    (acc[model.provider] ||= []).push(model);
    return acc;
  }, {});
  return Object.entries(grouped).map(([provider, models]) => ({ provider, models }));
}

export default function SettingsPage() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  const [openrouterApiKey, setOpenrouterApiKey] = useState("");
  const [nvidiaNimApiKey, setNvidiaNimApiKey] = useState("");
  const [nvidiaNimBaseUrl, setNvidiaNimBaseUrl] = useState("");
  const [ollamaHost, setOllamaHost] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [autoCompressThreshold, setAutoCompressThreshold] = useState(85);

  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modelsList, setModelsList] = useState<ModelInfo[]>([]);

  const modelGroups = useMemo(() => groupModelsByProvider(modelsList), [modelsList]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setOpenrouterApiKey(localStorage.getItem(STORAGE_KEYS.openrouterApiKey) || "");
    setNvidiaNimApiKey(localStorage.getItem(STORAGE_KEYS.nvidiaNimApiKey) || "");
    setNvidiaNimBaseUrl(localStorage.getItem(STORAGE_KEYS.nvidiaNimBaseUrl) || "");
    setOllamaHost(localStorage.getItem(STORAGE_KEYS.ollamaHost) || "http://localhost:11434");
    setDefaultModel(localStorage.getItem(STORAGE_KEYS.defaultModel) || "");
    setAutoCompressThreshold(
      parseInt(localStorage.getItem(STORAGE_KEYS.autoCompressThreshold) || "85", 10),
    );
  }, []);

  useEffect(() => {
    fetchAnalytics();
    fetchModels();
  }, []);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 3000);
    return () => clearTimeout(timer);
  }, [saved]);

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

  function modelsFetchHeaders(): HeadersInit {
    const { openrouterApiKey, nvidiaNimApiKey } = getClientApiKeys();
    const headers: Record<string, string> = {};
    if (openrouterApiKey) headers["x-openrouter-api-key"] = openrouterApiKey;
    if (nvidiaNimApiKey) headers["x-nvidia-nim-api-key"] = nvidiaNimApiKey;
    return headers;
  }

  async function fetchModels() {
    try {
      const res = await fetch("/api/models", { headers: modelsFetchHeaders() });
      if (res.ok) {
        const data = await res.json();
        setModelsList(data.models || []);
      }
    } catch (error) {
      console.error("Failed to fetch models:", error);
    }
  }

  function handleSave() {
    setSaving(true);
    localStorage.setItem(STORAGE_KEYS.openrouterApiKey, openrouterApiKey);
    localStorage.setItem(STORAGE_KEYS.nvidiaNimApiKey, nvidiaNimApiKey);
    localStorage.setItem(STORAGE_KEYS.nvidiaNimBaseUrl, nvidiaNimBaseUrl);
    localStorage.setItem(STORAGE_KEYS.ollamaHost, ollamaHost);
    localStorage.setItem(STORAGE_KEYS.defaultModel, defaultModel);
    localStorage.setItem(STORAGE_KEYS.autoCompressThreshold, String(autoCompressThreshold));
    setTimeout(() => {
      setSaving(false);
      setSaved(true);
    }, 300);
  }

  function handleClearSettings() {
    setOpenrouterApiKey("");
    setNvidiaNimApiKey("");
    setNvidiaNimBaseUrl("");
    setOllamaHost("http://localhost:11434");
    setDefaultModel("");
    setAutoCompressThreshold(85);
    localStorage.removeItem(STORAGE_KEYS.openrouterApiKey);
    localStorage.removeItem(STORAGE_KEYS.nvidiaNimApiKey);
    localStorage.removeItem(STORAGE_KEYS.nvidiaNimBaseUrl);
    localStorage.removeItem(STORAGE_KEYS.ollamaHost);
    localStorage.removeItem(STORAGE_KEYS.defaultModel);
    localStorage.removeItem(STORAGE_KEYS.autoCompressThreshold);
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
    <div className="flex h-screen bg-[var(--background)]">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <main className="text-[var(--foreground)] p-8">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-3xl font-bold">Settings & Analytics</h1>
            <Link
              href="/kb"
              className="flex items-center gap-2 px-4 py-2 glass-button-primary text-white rounded-[var(--glass-radius-md)]"
            >
              <BookOpen size={18} />
              Knowledge Base
            </Link>
          </div>

          {saved && (
            <div className="mb-6 px-4 py-3 glass-card rounded-[var(--glass-radius-md)] border border-emerald-900/50 text-emerald-300 text-sm">
              Settings saved successfully.
            </div>
          )}

          <div className="space-y-8 max-w-4xl">
            {/* API Keys */}
            <div className="glass-card rounded-[var(--glass-radius-xl)] p-6">
              <h2 className="text-xl font-bold mb-6">API Keys</h2>
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    OpenRouter API Key
                  </label>
                  <input
                    type="text"
                    value={openrouterApiKey}
                    onChange={(e) => setOpenrouterApiKey(e.target.value)}
                    placeholder="sk-or-..."
                    className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm"
                  />
                  <p className="text-xs text-zinc-500 mt-1">
                    API key for OpenRouter gateway — gives access to 300+ models.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    NVIDIA NIM API Key
                  </label>
                  <input
                    type="text"
                    value={nvidiaNimApiKey}
                    onChange={(e) => setNvidiaNimApiKey(e.target.value)}
                    placeholder="nvapi-..."
                    className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm"
                  />
                  <p className="text-xs text-zinc-500 mt-1">
                    API key for NVIDIA NIM hosted models.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">
                    NVIDIA NIM Base URL
                  </label>
                  <input
                    type="text"
                    value={nvidiaNimBaseUrl}
                    onChange={(e) => setNvidiaNimBaseUrl(e.target.value)}
                    placeholder="https://integrate.api.nvidia.com/v1"
                    className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm"
                  />
                  <p className="text-xs text-zinc-500 mt-1">
                    Base URL for NVIDIA NIM API endpoint.
                  </p>
                </div>
              </div>
            </div>

            {/* Ollama */}
            <div className="glass-card rounded-[var(--glass-radius-xl)] p-6">
              <h2 className="text-xl font-bold mb-4">Ollama</h2>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">
                  Ollama Host URL
                </label>
                <input
                  type="text"
                  value={ollamaHost}
                  onChange={(e) => setOllamaHost(e.target.value)}
                  placeholder="http://localhost:11434"
                  className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm"
                />
                <p className="text-xs text-zinc-500 mt-1">
                  URL of your Ollama instance for local models.
                </p>
              </div>
            </div>

            {/* Default Model */}
            <div className="glass-card rounded-[var(--glass-radius-xl)] p-6">
              <h2 className="text-xl font-bold mb-4">Default Model</h2>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">
                  Model
                </label>
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

            {/* Save / Clear */}
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
      </div>
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
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ext = format === "sharegpt" ? ".json" : ".jsonl";
      a.download = `vas-dataset${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
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
