"use client";

import { useState, useMemo } from "react";
import { Search, RotateCcw, Check, Wrench, Eye, Brain } from "lucide-react";
import SectionHeader from "../ui/SectionHeader";
import AsyncButton from "../ui/AsyncButton";
import type { ModelCatalogEntry } from "@/lib/models";
import { formatContext } from "@/lib/utils/messageParts";

interface ModelPickerProps {
  models: ModelCatalogEntry[];
  selectedModel: string;
  onSelect: (id: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
}

export default function ModelPicker({
  models,
  selectedModel,
  onSelect,
  refreshing,
  onRefresh,
}: ModelPickerProps) {
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const providers = useMemo(() => {
    const set = new Set<string>();
    for (const m of models) set.add(m.provider);
    return Array.from(set).sort();
  }, [models]);

  const activeProvider = selectedProvider ?? providers[0] ?? null;

  const filteredModels = useMemo(() => {
    let m = models;
    if (activeProvider) m = m.filter((x) => x.provider === activeProvider);
    if (search.trim()) {
      const q = search.toLowerCase();
      m = m.filter(
        (x) =>
          x.name.toLowerCase().includes(q) ||
          x.id.toLowerCase().includes(q),
      );
    }
    return m;
  }, [models, activeProvider, search]);

  return (
    <section>
      <SectionHeader>Model</SectionHeader>
      <div className="space-y-2">
        {/* Provider tabs */}
        <div className="flex gap-1 overflow-x-auto">
          {providers.map((p) => (
            <button
              key={p}
              onClick={() => { setSelectedProvider(p); setSearch(""); }}
              className={`whitespace-nowrap px-2.5 py-1 rounded text-xs font-medium transition ${
                activeProvider === p
                  ? "bg-blue-600 text-white"
                  : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Search */}
        {filteredModels.length > 8 && (
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search models..."
              className="w-full glass-input rounded-[var(--glass-radius-md)] pl-8 pr-3 py-1.5 text-xs"
            />
          </div>
        )}

        {/* Model list (compact) */}
        <div className="max-h-56 overflow-y-auto glass-card rounded-[var(--glass-radius-md)] divide-y divide-[var(--glass-border)]">
          {filteredModels.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-zinc-500">
              No models match
            </div>
          ) : filteredModels.map((model) => (
            <button
              key={model.id}
              onClick={() => onSelect(model.id)}
              className={`w-full text-left px-3 py-2 text-xs transition flex items-center gap-2 hover:bg-[var(--glass-bg-hover)] ${
                selectedModel === model.id ? "bg-blue-600/10" : ""
              }`}
            >
              <div className="w-4 shrink-0">
                {selectedModel === model.id && (
                  <Check size={14} className="text-blue-400" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-zinc-100 truncate flex items-center gap-1">
                  {model.name}
                  {model.supportsTools && <span title="Supports tools"><Wrench size={10} className="text-zinc-500 shrink-0" /></span>}
                  {model.supportsVision && <span title="Vision capable"><Eye size={10} className="text-zinc-500 shrink-0" /></span>}
                  {model.supportsThinking && <span title="Supports thinking"><Brain size={10} className="text-zinc-500 shrink-0" /></span>}
                </div>
                <div className="text-zinc-500 truncate">{model.id.split('/').pop()}</div>
              </div>
              <div className="text-zinc-600 shrink-0">
                {formatContext(model.contextWindow)} ctx
              </div>
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-500">
            {filteredModels.length} model{filteredModels.length !== 1 ? "s" : ""}
          </span>
          <AsyncButton
            onClick={onRefresh}
            loading={refreshing}
            loadingText="…"
            icon={<RotateCcw size={12} />}
            className="text-xs text-zinc-400 hover:text-white flex items-center gap-1"
          >
            Refresh
          </AsyncButton>
        </div>
      </div>
    </section>
  );
}
