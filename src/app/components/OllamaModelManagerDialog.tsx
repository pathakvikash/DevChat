"use client";

import { useState } from "react";
import { Loader2, Trash2, Download, RefreshCw, HardDrive, Wrench, Eye, Brain } from "lucide-react";
import SidePanel from "./ui/SidePanel";
import AsyncButton from "./ui/AsyncButton";
import { useResource } from "@/app/hooks/useResource";

interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modifiedAt: string;
  details?: {
    family: string;
    parameterSize: string;
    quantizationLevel: string;
  };
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = (bytes / Math.pow(1024, i)).toFixed(1);
  return `${size} ${units[i]}`;
}

function isVisionModel(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes("vision") || n.includes("llava") || n.includes("vl") ||
    n.includes("gemma3") || n.includes("pixtral") || n.includes("minicpm");
}

function isThinkingModel(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes("deepseek-r1") || n.includes("qwq") || n.includes("thinking");
}

function isToolFamily(family: string): boolean {
  const f = family.toLowerCase();
  return f.includes("llama") || f.includes("qwen") || f.includes("mistral") ||
    f.includes("mixtral") || f.includes("nemotron") || f.includes("granite") ||
    f.includes("deepseek") || f.includes("phi") || f.includes("command-r");
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface PullStatus {
  status: string;
  completed?: number;
  total?: number;
  digest?: string;
}

interface OllamaModelManagerDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function OllamaModelManagerDialog({
  isOpen,
  onClose,
}: OllamaModelManagerDialogProps) {
  const [modelName, setModelName] = useState("");
  const [pulling, setPulling] = useState(false);
  const [pullStatus, setPullStatus] = useState<PullStatus | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const {
    data: modelsData,
    loading,
    refetch: refreshModels,
  } = useResource<OllamaModel[]>(
    async () => {
      const res = await fetch("/api/ollama/models");
      if (!res.ok) throw new Error("Failed to fetch models");
      const data = await res.json();
      return data.models || [];
    },
    [],
    { enabled: isOpen },
  );
  const models = modelsData ?? [];

  async function handlePull() {
    const name = modelName.trim();
    if (!name) return;

    setPulling(true);
    setPullStatus({ status: "Starting..." });

    try {
      const res = await fetch("/api/ollama/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (!res.ok) {
        const err = await res.json();
        setPullStatus({ status: `Error: ${err.error || "Pull failed"}` });
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const status: PullStatus = JSON.parse(line);
            setPullStatus(status);
            if (status.status === "success") {
              void refreshModels();
              setModelName("");
            }
          } catch {
          }
        }
      }
    } catch (e: any) {
      setPullStatus({ status: `Error: ${e.message || "Pull failed"}` });
    } finally {
      setPulling(false);
    }
  }

  async function handleDelete(name: string) {
    if (!confirm(`Delete model "${name}"? This cannot be undone.`)) return;
    setDeleting(name);
    try {
      const res = await fetch("/api/ollama/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(`Failed to delete: ${err.error}`);
        return;
      }
      void refreshModels();
    } catch (e: any) {
      alert(`Failed to delete: ${e.message}`);
    } finally {
      setDeleting(null);
    }
  }

  const pullProgress = pullStatus?.total
    ? Math.round(((pullStatus.completed || 0) / pullStatus.total) * 100)
    : null;

  return (
    <SidePanel
      isOpen={isOpen}
      onClose={onClose}
      title="Ollama Model Manager"
      subtitle="List, pull, and delete local models"
      widthClass="max-w-xl"
    >
      <section>
        <h3 className="text-sm font-semibold text-white uppercase tracking-wider mb-3">
          Pull Model
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            placeholder="e.g. llama3.2:3b"
            className="flex-1 glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !pulling) void handlePull();
            }}
          />
          <AsyncButton
            onClick={() => void handlePull()}
            loading={pulling}
            loadingText="Pulling..."
            icon={<Download size={16} />}
            disabled={!modelName.trim() || pulling}
            variant="primary"
            className="px-4 py-2 text-sm font-medium"
          >
            Pull
          </AsyncButton>
        </div>
        {pullStatus && (
          <div className="mt-2 text-xs text-zinc-400">
            {pullProgress !== null && (
              <div className="mb-1 w-full glass rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all"
                  style={{ width: `${pullProgress}%` }}
                />
              </div>
            )}
            <span>{pullStatus.status}</span>
            {pullStatus.digest && (
              <span className="ml-1 font-mono text-zinc-500">
                {pullStatus.digest.slice(0, 12)}
              </span>
            )}
            {pullProgress !== null && (
              <span className="ml-1">{pullProgress}%</span>
            )}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white uppercase tracking-wider">
            Local Models
          </h3>
          <button
            onClick={() => void refreshModels()}
            className="p-1 glass-button rounded text-zinc-400 transition"
            title="Refresh models"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-zinc-400 py-4">
            <Loader2 size={16} className="animate-spin" />
            Loading models…
          </div>
        ) : models.length === 0 ? (
          <div className="text-zinc-500 text-sm py-8 text-center">
            <HardDrive size={32} className="mx-auto mb-2 opacity-50" />
            No local models found.
          </div>
        ) : (
          <div className="space-y-1">
            {models.map((model) => (
              <div
                key={model.name}
                className="flex items-center gap-3 px-3 py-2.5 glass-card rounded-[var(--glass-radius-md)]"
              >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white font-medium truncate flex items-center gap-1">
                      {model.name}
                      {(isVisionModel(model.name)) && <span title="Vision capable"><Eye size={12} className="text-zinc-500 shrink-0" /></span>}
                      {(isThinkingModel(model.name)) && <span title="Supports thinking"><Brain size={12} className="text-zinc-500 shrink-0" /></span>}
                      {model.details?.family && isToolFamily(model.details.family) && <span title="Supports tools"><Wrench size={12} className="text-zinc-500 shrink-0" /></span>}
                    </div>
                    <div className="text-xs text-zinc-500 flex gap-3 mt-0.5">
                    <span>{formatSize(model.size)}</span>
                    <span>{formatDate(model.modifiedAt)}</span>
                  </div>
                </div>
                <button
                  onClick={() => void handleDelete(model.name)}
                  disabled={deleting === model.name}
                  className="p-1.5 hover:bg-red-900/50 rounded text-zinc-400 hover:text-red-400 transition disabled:opacity-50"
                  title="Delete model"
                >
                  {deleting === model.name ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Trash2 size={16} />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </SidePanel>
  );
}
