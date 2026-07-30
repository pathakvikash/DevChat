"use client";

import { useEffect, useMemo, useState } from "react";
import { Database, Loader2, Save } from "lucide-react";
import SidePanel from "./ui/SidePanel";
import ErrorBanner from "./ui/ErrorBanner";
import SectionHeader from "./ui/SectionHeader";
import AsyncButton from "./ui/AsyncButton";
import { useResource } from "@/app/hooks/useResource";
import { fetchModels as apiFetchModels } from "@/app/hooks/useModelsApi";
import type { ModelInfo } from "@/app/components/conversation/types";
import { useToast } from "@/app/components/Toast";
import ModelPicker from "./modelSettings/ModelPicker";
import GenerationParams from "./modelSettings/GenerationParams";
import PersonaSelector from "./PersonaSelector";

interface KbInfo {
  id: string;
  name: string;
  description: string | null;
  _count: { documents: number };
}

interface ModelSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId: string;
  currentModel: string;
  currentSystemPrompt: string;
  currentTemperature: number;
  currentContextLength: number | undefined;
  currentTopP: number | undefined;
  currentMaxTokens: number | undefined;
  currentChatOnlyMode: boolean;
  currentKbId: string | null;
  currentMaxToolCalls?: number;
  currentFallbackModel?: string | null;
  currentPersona?: string | null;
  onSave: (settings: {
    model?: string;
    systemPrompt?: string;
    temperature?: number;
    contextLength?: number;
    topP?: number;
    maxTokens?: number;
    chatOnlyMode?: boolean;
    kbId?: string | null;
    maxToolCalls?: number;
    fallbackModel?: string | null;
    persona?: string | null;
  }) => void;
}

export default function ModelSettingsDialog({
  isOpen,
  onClose,
  conversationId,
  currentModel,
  currentSystemPrompt,
  currentTemperature,
  currentContextLength,
  currentTopP,
  currentMaxTokens,
  currentChatOnlyMode,
  currentKbId,
  currentMaxToolCalls,
  currentFallbackModel,
  currentPersona,
  onSave,
}: ModelSettingsDialogProps) {
  const [selectedModel, setSelectedModel] = useState(currentModel);
  const [systemPrompt, setSystemPrompt] = useState(currentSystemPrompt);
  const [persona, setPersona] = useState<string>(currentPersona || "");
  const [temperature, setTemperature] = useState(currentTemperature);
  const [contextLength, setContextLength] = useState(
    currentContextLength || 8192,
  );
  const [topP, setTopP] = useState(currentTopP ?? 0.9);
  const [maxTokens, setMaxTokens] = useState(
    currentMaxTokens ? String(currentMaxTokens) : "",
  );
  const [chatOnlyMode, setChatOnlyMode] = useState(currentChatOnlyMode);
  const [maxToolCalls, setMaxToolCalls] = useState(currentMaxToolCalls ?? 5);
  const [fallbackModel, setFallbackModel] = useState<string>(currentFallbackModel || "");
  const [kbId, setKbId] = useState<string>(currentKbId || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const {
    data: modelsData,
    loading,
    refetch: refreshModels,
  }: {
    data: ModelInfo[] | null;
    loading: boolean;
    refetch: () => Promise<void>;
  } = useResource<ModelInfo[]>(
    async () => {
      return apiFetchModels();
    },
    [],
    { enabled: isOpen, onError: (e) => console.error("Failed to fetch models:", e) },
  );
  const models = modelsData ?? [];

  useEffect(() => {
    if (isOpen) {
      setSelectedModel(currentModel);
      setSystemPrompt(currentSystemPrompt);
      setTemperature(currentTemperature);
      const modelCtx = models.find((m) => m.id === currentModel)?.contextWindow;
      setContextLength(currentContextLength || modelCtx || 8192);
      setTopP(currentTopP ?? 0.9);
      setMaxTokens(currentMaxTokens ? String(currentMaxTokens) : "");
      setChatOnlyMode(currentChatOnlyMode);
      setMaxToolCalls(currentMaxToolCalls ?? 5);
      setFallbackModel(currentFallbackModel || "");
      setKbId(currentKbId || "");
      setPersona(currentPersona || "");
      setError(null);
    }
  }, [isOpen, currentModel, currentSystemPrompt, currentTemperature, currentContextLength, currentTopP, currentMaxTokens, currentChatOnlyMode, currentKbId, currentMaxToolCalls, currentFallbackModel, currentPersona, models]);
  const modelInfo = useMemo<ModelInfo | null>(
    () => models.find((m) => m.id === selectedModel) || null,
    [selectedModel, models],
  );
  useEffect(() => {
    setKbId(currentKbId || "");
  }, [currentKbId]);

  const { data: kbsData }: { data: KbInfo[] | null } = useResource<KbInfo[]>(
    async () => {
      const res = await fetch("/api/kb");
      if (!res.ok) throw new Error("Failed to fetch knowledge bases");
      return (await res.json()) as KbInfo[];
    },
    [],
    { enabled: isOpen, onError: (e) => console.error("Failed to fetch KBs:", e) },
  );
  const kbs = kbsData ?? [];
  const selectedKb = kbs.find((k) => k.id === kbId) || null;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedModel,
          systemPrompt: systemPrompt.trim() || undefined,
          temperature,
          contextLength,
          topP,
          maxTokens: maxTokens ? parseInt(maxTokens, 10) : undefined,
          chatOnlyMode,
          kbId: kbId || null,
          maxToolCalls,
          fallbackModel: fallbackModel || null,
          persona: persona || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to save settings");
      onSave({
        model: selectedModel,
        systemPrompt: systemPrompt.trim() || undefined,
        temperature,
        contextLength,
        topP,
        maxTokens: maxTokens ? parseInt(maxTokens, 10) : undefined,
        chatOnlyMode,
        kbId: kbId || null,
        maxToolCalls,
        fallbackModel: fallbackModel || null,
        persona: persona || null,
      });
      toast("Conversation saved", "success");
      onClose();
    } catch (e: any) {
      setError(e.message || "Failed to save settings");
      toast("Failed to save settings", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SidePanel
      isOpen={isOpen}
      onClose={onClose}
      title="Model Settings"
      subtitle="Per-conversation configuration"
      widthClass="max-w-2xl"
      footer={
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-zinc-300 glass-button rounded-[var(--glass-radius-md)]"
          >
            Cancel
          </button>
          <AsyncButton
            onClick={handleSave}
            loading={saving}
            loadingText="Saving..."
            icon={<Save size={16} />}
            variant="primary"
            className="px-4 py-2 text-sm font-medium"
          >
            Save Settings
          </AsyncButton>
        </div>
      }
    >
      {loading ? (
        <div className="flex items-center gap-2 text-zinc-400">
          <Loader2 size={16} className="animate-spin" />
          Loading models…
        </div>
      ) : (
        <>
          <ModelPicker
            models={models}
            selectedModel={selectedModel}
            onSelect={setSelectedModel}
            refreshing={false}
            onRefresh={() => {
              void refreshModels();
            }}
          />

          <section>
            <SectionHeader>Fallback Model</SectionHeader>
            <p className="text-xs text-zinc-400 mb-2">
              If the primary model fails (rate limit, outage, auth error), the
              request automatically retries with backoff and then falls back to
              this model before giving up. You can also set a global default via
              the <code className="text-zinc-300">VAS_FALLBACK_MODEL</code> env var.
            </p>
            <select
              value={fallbackModel}
              onChange={(e) => setFallbackModel(e.target.value)}
              className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm"
            >
              <option value="">— None (no fallback) —</option>
              {models
                .filter((m) => m.id !== selectedModel)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                  </option>
                ))}
            </select>
          </section>

          <section>
            <SectionHeader>Knowledge Base</SectionHeader>
            <div className="flex items-center gap-2 mb-2">
              <Database size={14} className="text-emerald-400" />
              <p className="text-xs text-zinc-400">
                Attach a knowledge base so the <code className="text-zinc-300">searchKnowledgeBase</code> tool can retrieve excerpts.{" "}
                {kbs.length === 0 && (
                  <a
                    href="/kb"
                    className="text-blue-400 hover:underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Create one →
                  </a>
                )}
              </p>
            </div>
            <select
              value={kbId}
              onChange={(e) => setKbId(e.target.value)}
              className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm"
            >
              <option value="">— None (disable KB retrieval) —</option>
              {kbs.map((kb) => (
                <option key={kb.id} value={kb.id}>
                  {kb.name} ({kb._count.documents} doc{kb._count.documents === 1 ? "" : "s"})
                </option>
              ))}
            </select>
            {selectedKb?.description && (
              <p className="text-xs text-zinc-500 mt-1">{selectedKb.description}</p>
            )}
            <p className="text-xs text-zinc-500 mt-1">
              Don't see your KB?{" "}
              <a
                href="/kb"
                className="text-blue-400 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Manage knowledge bases →
              </a>
            </p>
          </section>

          <section>
            <SectionHeader>Persona</SectionHeader>
            <p className="text-xs text-zinc-400 mb-2">
              Pick a saved persona to prefill the system prompt below with its
              instructions. You can still edit the prompt afterward.
            </p>
            <PersonaSelector
              value={persona}
              disabled={saving}
              onSelect={(p) => {
                setPersona(p.id);
                setSystemPrompt(p.systemPrompt);
              }}
            />
          </section>

          <section>
            <SectionHeader>System Prompt</SectionHeader>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Optional: Custom instructions for this conversation..."
              className="w-full min-h-25 glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm resize-y"
              rows={4}
            />
            <p className="text-xs text-zinc-500 mt-1">
              Injected as the first system message in every request.
            </p>
          </section>

          <GenerationParams
            temperature={temperature}
            onTemperatureChange={setTemperature}
            topP={topP}
            onTopPChange={setTopP}
            contextLength={contextLength}
            onContextLengthChange={setContextLength}
            maxTokens={maxTokens}
            onMaxTokensChange={setMaxTokens}
            maxContextWindow={modelInfo?.contextWindow ?? 0}
            chatOnlyMode={chatOnlyMode}
            onChatOnlyModeChange={setChatOnlyMode}
            maxToolCalls={maxToolCalls}
            onMaxToolCallsChange={setMaxToolCalls}
          />

          {error && <ErrorBanner>{error}</ErrorBanner>}
        </>
      )}
    </SidePanel>
  );
}
