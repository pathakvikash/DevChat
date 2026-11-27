"use client";

import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, RotateCcw, Loader2, Settings, Wrench, Eye, Brain } from "lucide-react";
import { formatContext } from "@/lib/utils/messageParts";
import AsyncButton from "../ui/AsyncButton";
import { useResource } from "@/app/hooks/useResource";
import { fetchModels as apiFetchModels, fetchModelUsage } from "@/app/hooks/useModelsApi";
import { ModelInfo, groupModelsByProvider } from "./types";
import { useBridge } from "@/app/hooks/useBridge";
import { useFolders } from "@/app/hooks/useFolders";
import { bridgeProblemText } from "@/lib/bridge/client";

interface ModelSelectorProps {
  currentModel: string;
  onModelChange: (modelId: string) => void;
  onOpenSettings?: () => void;
  disabled?: boolean;
  size?: "default" | "sm";
  /** Models to leave out of the list. */
  exclude?: (m: ModelInfo) => boolean;
  /** Opens the list in a portal, fixed to the viewport next to the trigger, so a scrolling or clipping parent (a drawer) cannot cut it off. */
  floating?: boolean;
}

const PANEL_W = 288; // w-72
const EDGE = 8;
type Place = { left: number; top?: number; bottom?: number; maxHeight: number };

export default function ModelSelector({
  currentModel,
  onModelChange,
  onOpenSettings,
  disabled = false,
  size = "default",
  exclude,
  floating = false,
}: ModelSelectorProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Place | null>(null);

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
      const t = e.target as Node;
      if (containerRef.current && !containerRef.current.contains(t) && !panelRef.current?.contains(t)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showDropdown]);

  // Floating: left-aligned to the trigger, kept 8px inside the viewport, below it if the list fits (else the roomier side), height capped to that side.
  const placePanel = useCallback(() => {
    const trigger = containerRef.current?.querySelector("button");
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const r = trigger.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    panel.style.maxHeight = "";
    const natural = panel.offsetHeight;
    const below = vh - r.bottom - EDGE - 4;
    const above = r.top - EDGE - 4;
    const down = below >= natural || below >= above;
    setPlace({
      left: Math.max(EDGE, Math.min(r.left, vw - PANEL_W - EDGE)),
      ...(down ? { top: r.bottom + 4 } : { bottom: vh - r.top + 4 }),
      maxHeight: Math.max(120, down ? below : above),
    });
  }, []);

  useLayoutEffect(() => {
    if (!floating || !showDropdown) return;
    placePanel();
    const onScroll = (e: Event) => {
      if (!panelRef.current?.contains(e.target as Node)) placePanel();
    };
    window.addEventListener("resize", placePanel);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", placePanel);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [floating, showDropdown, placePanel, selectedProvider]);

  const {
    data: modelsData,
    loading,
    refetch: refreshModels,
  } = useResource<ModelInfo[]>(
    async () => {
      const [models, { usage }] = await Promise.all([
        apiFetchModels(),
        fetchModelUsage(),
      ]);

      return models.map((m) => ({ ...m, usageCount: usage[m.id] || 0 }));
    },
    [],
    { onError: (e) => console.error("Failed to load models:", e) },
  );
  // Deployed with a bridge token stored: the bridge's models join the list, disabled while it cannot be reached.
  const bridge = useBridge();
  const { noHostTools } = useFolders(true, { bridge: true });
  const bridgeModels: ModelInfo[] =
    noHostTools === true && bridge.hasToken
      ? bridge.models.map((m) => ({
          ...m,
          viaBridge: true,
          supportsTools: true,
          ...(bridge.status === "ready" ? {} : { disabledReason: bridgeProblemText(bridge.status, bridge.protocol) ?? undefined }),
        }))
      : [];
  const models = [...(modelsData ?? []), ...bridgeModels.filter((b) => !modelsData?.some((m) => m.id === b.id))].filter((m) => !exclude?.(m));

  const modelGroups = useMemo(() => {
    return groupModelsByProvider(models).map((g) => ({
      ...g,
      models: [...g.models].sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0)),
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
        data-model-picker
        onClick={() => {
          if (disabled) return;
          setSelectedProvider(currentModelInfo?.provider ?? null);
          if (!showDropdown && bridge.hasToken) void bridge.check(5_000);
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
      {showDropdown && (() => {
        const panel = (
        <div
          ref={panelRef}
          style={floating ? { left: place?.left, top: place?.top, bottom: place?.bottom, maxHeight: place?.maxHeight, visibility: place ? "visible" : "hidden" } : undefined}
          className={floating
            ? "fixed z-[100] w-72 glass-panel-strong rounded-[var(--glass-radius-md)] shadow-lg flex flex-col"
            : `absolute right-0 z-50 w-72 glass-panel-strong rounded-[var(--glass-radius-md)] shadow-lg flex flex-col ${size === "sm" ? "bottom-full mb-2" : "mt-2"}`}
        >
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
                disabled={!!model.disabledReason}
                onClick={() => {
                  onModelChange(model.id);
                  setShowDropdown(false);
                }}
                className={`w-full text-left px-4 py-3 text-sm hover:bg-[var(--glass-bg-hover)] border-b border-[var(--glass-border)] last:border-b-0 disabled:cursor-not-allowed disabled:opacity-60 ${
                  currentModel === model.id ? "bg-[var(--glass-bg-active)]" : ""
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-medium">{model.name}</span>
                  {model.viaBridge && <span className="rounded bg-[var(--glass-bg-active)] px-1.5 py-0.5 text-[10px] text-zinc-400">via local bridge</span>}
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
                {model.disabledReason && <div className="text-xs text-amber-400">{model.disabledReason}</div>}
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
        );
        return floating ? createPortal(panel, document.body) : panel;
      })()}
    </div>
  );
}
