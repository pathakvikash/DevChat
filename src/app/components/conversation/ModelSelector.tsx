"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { ChevronDown, RotateCcw, Loader2, Settings, Wrench, Eye, Brain } from "lucide-react";
import { formatContext } from "@/lib/utils/messageParts";
import AsyncButton from "../ui/AsyncButton";
import { useResource } from "@/app/hooks/useResource";
import { getClientApiKeys } from "@/lib/apiKeys";
import { ModelInfo, ModelGroup } from "./types";

interface ModelSelectorProps {
  currentModel: string;
  onModelChange: (modelId: string) => void;
  onOpenSettings?: () => void;
  disabled?: boolean;
  size?: "default" | "sm";
}

export default function ModelSelector({
  currentModel,
  onModelChange,
  onOpenSettings,
  disabled = false,
  size = "default",
}: ModelSelectorProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  const scrollToSelected = useCallback(() => {
    requestAnimationFrame(() => {
      selectedRef.current?.scrollIntoView({ block: "nearest" });
    });
  }, []);

  useEffect(() => {
    if (showDropdown) scrollToSelected();
  }, [showDropdown, scrollToSelected]);

  useEffect(() => {
    if (!showDropdown) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showDropdown]);

  const {
    data: modelsData,
    loading,
    refetch: refreshModels,
  } = useResource<ModelInfo[]>(
    async () => {
      const apiKeys = getClientApiKeys();
      const headers: Record<string, string> = {};
      if (apiKeys.openrouterApiKey) headers["x-openrouter-api-key"] = apiKeys.openrouterApiKey;
      if (apiKeys.nvidiaNimApiKey) headers["x-nvidia-nim-api-key"] = apiKeys.nvidiaNimApiKey;
      const [modelsRes, usageRes] = await Promise.all([
        fetch("/api/models", { headers }),
        fetch("/api/models/usage"),
      ]);
      if (!modelsRes.ok) throw new Error("Failed to fetch models");
      const modelsData = await modelsRes.json();
      const models: ModelInfo[] = modelsData.models || [];

      const usage: Record<string, number> = usageRes.ok
        ? (await usageRes.json()).usage || {}
        : {};

      return models.map((m) => ({ ...m, usageCount: usage[m.id] || 0 }));
    },
    [],
    { onError: (e) => console.error("Failed to load models:", e) },
  );
  const models = modelsData ?? [];

  const modelGroups = useMemo(() => {
    const grouped = models.reduce<Record<string, ModelInfo[]>>((acc, model) => {
      (acc[model.provider] ||= []).push(model);
      return acc;
    }, {});
    return Object.entries(grouped)
      .map(([provider, models]) => ({
        provider,
        models: [...models].sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0)),
      }));
  }, [models]);

  const currentModelInfo = models.find((m) => m.id === currentModel);

  const activeProvider = selectedProvider ?? currentModelInfo?.provider ?? modelGroups[0]?.provider;

  const filteredModels = useMemo(() => {
    if (!activeProvider) return models;
    return models.filter((m) => m.provider === activeProvider)
      .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
  }, [models, activeProvider]);

  if (loading) {
    return (
      <div className="relative">
        <button
          disabled
          className="flex items-center gap-2 glass-button text-white rounded-[var(--glass-radius-md)] px-3 py-2 text-sm animate-pulse"
        >
          <div className="flex flex-col items-start">
            <span>Loading...</span>
            <span className="text-xs text-zinc-400">models</span>
          </div>
          <Loader2 size={16} className="animate-spin" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => {
          if (disabled) return;
          setSelectedProvider(currentModelInfo?.provider ?? null);
          setShowDropdown(!showDropdown);
        }}
        disabled={disabled}
        className={`flex items-center gap-2 rounded-[var(--glass-radius-md)] px-3 py-2 text-sm transition disabled:opacity-50 ${
          size === "sm"
            ? "glass-button text-zinc-300"
            : "glass-button text-[var(--foreground)]"
        }`}
      >
        {size === "sm" ? (
          <div className="flex items-center gap-1 max-w-[160px]">
            <span className="text-xs truncate">{(currentModelInfo?.name || currentModel).split('/').pop()}</span>
            {currentModelInfo?.supportsVision && <Eye size={10} className="text-zinc-500 shrink-0" />}
            <ChevronDown size={12} className="shrink-0 text-zinc-500" />
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <span>{(currentModelInfo?.name || currentModel).split('/').pop()}</span>
            {currentModelInfo?.supportsTools && <Wrench size={13} className="text-zinc-500" />}
            {currentModelInfo?.supportsVision && <Eye size={13} className="text-zinc-500" />}
            {currentModelInfo?.supportsThinking && <Brain size={13} className="text-zinc-500" />}
          </div>
        )}
        {size !== "sm" && <ChevronDown size={16} />}
      </button>
      {showDropdown && (
        <div className={`absolute right-0 z-50 w-72 glass-panel-strong rounded-[var(--glass-radius-md)] shadow-lg flex flex-col ${
          size === "sm" ? "bottom-full mb-2" : "mt-2"
        }`}>
          <div className="p-2 border-b border-[var(--glass-border)] flex items-center justify-between">
            <span className="text-xs font-bold text-zinc-300">Models</span>
            <AsyncButton
              onClick={refreshModels}
              loading={loading}
              loadingText="Refreshing"
              icon={<RotateCcw size={12} />}
              className="text-xs text-zinc-400 hover:text-white flex items-center gap-1"
              title="Refresh models"
            >
              Refresh
            </AsyncButton>
          </div>

          {/* Provider tabs */}
          <div className="flex gap-1 px-2 py-1.5 border-b border-[var(--glass-border)] overflow-x-auto">
            {modelGroups.map((g) => (
              <button
                key={g.provider}
                onClick={() => setSelectedProvider(g.provider)}
                className={`whitespace-nowrap px-2.5 py-1 rounded text-xs font-medium transition ${
                  activeProvider === g.provider
                    ? "glass-button-primary text-white"
                    : "glass-button text-zinc-300"
                }`}
              >
                {g.provider}
              </button>
            ))}
          </div>

          <div className="overflow-y-auto max-h-80">
            {filteredModels.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-zinc-500">
                No models available for {activeProvider}
              </div>
            ) : filteredModels.map((model) => (
              <button
                key={model.id}
                ref={model.id === currentModel ? selectedRef : undefined}
                onClick={() => {
                  onModelChange(model.id);
                  setShowDropdown(false);
                }}
                className={`w-full text-left px-4 py-3 text-sm hover:bg-[var(--glass-bg-hover)] border-b border-[var(--glass-border)] last:border-b-0 ${
                  currentModel === model.id ? "bg-[var(--glass-bg-active)]" : ""
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-medium">{model.name}</span>
                  <div className="flex items-center gap-0.5 ml-1">
                    {model.supportsTools && <span title="Supports tools"><Wrench size={11} className="text-zinc-500" /></span>}
                    {model.supportsVision && <span title="Vision capable"><Eye size={11} className="text-zinc-500" /></span>}
                    {model.supportsThinking && <span title="Supports thinking"><Brain size={11} className="text-zinc-500" /></span>}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">{model.id.split('/').pop()}</span>
                  {model.usageCount ? (
                    <span className="text-[10px] text-zinc-600">{model.usageCount} chats</span>
                  ) : null}
                </div>
                {model.contextWindow && (
                  <div className="text-xs text-zinc-500">{formatContext(model.contextWindow)} ctx</div>
                )}
              </button>
            ))}
          </div>

          {onOpenSettings && (
            <button
              onClick={() => {
                onOpenSettings();
                setShowDropdown(false);
              }}
              className="flex items-center gap-2 w-full px-4 py-2.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-[var(--glass-bg-hover)] border-t border-[var(--glass-border)] transition"
            >
              <Settings size={14} />
              <span>Model Config</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
