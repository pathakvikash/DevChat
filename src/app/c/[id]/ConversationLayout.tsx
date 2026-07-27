"use client";

import ChatMessages from "@/app/components/ChatMessages";
import MinimapNavigator from "@/app/components/MinimapNavigator";
import ChatInput from "@/app/components/chatInput";
import Scratchpad from "@/app/components/Scratchpad";
import ArtifactPanel from "@/app/components/ArtifactPanel";
import GoalPanel from "@/app/components/GoalPanel";
import TodoPanel from "@/app/components/TodoPanel";
import TodoIndicator from "@/app/components/TodoIndicator";
import AdvancedSettings from "@/app/components/AdvancedSettings";
import ModelSettingsDialog from "@/app/components/ModelSettingsDialog";
import ContextDetailsPanel from "@/app/components/ContextDetailsPanel";
import ToolErrorDialog from "@/app/components/ToolErrorDialog";
import RegenerationOptions from "@/app/components/RegenerationOptions";
import KeyboardShortcutsDialog from "@/app/components/KeyboardShortcutsDialog";
import { useCommandPaletteActions } from "@/app/components/CommandPalette";
import ConversationHeader from "@/app/components/conversation/ConversationHeader";
import EmptyState from "@/app/components/conversation/EmptyState";
import { useKeyboardShortcuts } from "@/app/hooks/useKeyboardShortcuts";
import { buildMessageParts } from "@/lib/utils/messageParts";
import { joinTextParts } from "@/lib/utils/conversation";
import { StickyNote, FileCode, SlidersHorizontal, Settings, BarChart3, Target } from "lucide-react";

import { useConversationPage } from "./useConversationPage";

interface Props {
  conversationId: string;
  initialPrompt?: string;
}

export default function ConversationLayout({ conversationId, initialPrompt }: Props) {
  const p = useConversationPage(conversationId, initialPrompt);

  useCommandPaletteActions("Panels", [
    { id: "goal", label: "Open Goal Mode", icon: <Target size={16} />, onSelect: () => p.setGoalPanelOpen(true) },
    { id: "scratchpad", label: "Open Scratchpad", icon: <StickyNote size={16} />, onSelect: () => p.setScratchpadOpen(true) },
    { id: "artifacts", label: "Open Artifacts", icon: <FileCode size={16} />, onSelect: () => p.setArtifactPanelOpen(true) },
    { id: "advanced-settings", label: "Advanced Settings", icon: <SlidersHorizontal size={16} />, onSelect: () => p.setAdvancedOpen(true) },
    { id: "model-settings", label: "Model Settings", icon: <Settings size={16} />, onSelect: () => p.setModelSettingsOpen(true) },
    { id: "context", label: "Context Usage", icon: <BarChart3 size={16} />, onSelect: () => p.setContextPanelOpen(true) },
  ]);

  useKeyboardShortcuts({
    onSend: () => {
      if (!p.input.trim() && p.files.length === 0) return;
      if (p.status === "streaming" || p.status === "submitted") return;
      buildMessageParts(p.input, p.files, p.conversation?.model).then(({ parts, attachments }) => {
        p.sendMessage({ parts }, { body: { attachments } }).then(() => {
          p.setInput("");
          p.setFiles([]);
        });
      });
    },
    isDialogOpen: p.isDialogOpen,
    onCloseDialog: p.closeTopDialog,
    onOpenKeyboardShortcuts: () => p.setKeyboardShortcutsOpen(true),
  });

  if (p.loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--background)] text-[var(--foreground)]">
        <div className="glass-card rounded-[var(--glass-radius-xl)] px-8 py-6 backdrop-blur-[var(--glass-blur-lg)]">
          Loading conversation...
        </div>
      </div>
    );
  }

  if (!p.conversation) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--background)] text-[var(--foreground)]">
        <div className="glass-card rounded-[var(--glass-radius-xl)] px-8 py-6">
          Conversation not found
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[var(--background)]">
      <main className="flex h-screen flex-1 min-w-0 flex-col bg-[var(--background)] text-[var(--foreground)]">
        <ConversationHeader
          conversation={p.conversation}
          messagesCount={p.messages.length}
          scratchpadOpen={p.scratchpadOpen}
          onToggleScratchpad={() => p.setScratchpadOpen((v: boolean) => !v)}
          artifactsOpen={p.artifactPanelOpen}
          onToggleArtifacts={() => p.setArtifactPanelOpen((v: boolean) => !v)}
          goalOpen={p.goalPanelOpen}
          onToggleGoal={() => p.setGoalPanelOpen((v: boolean) => !v)}
          enabledToolsCount={p.enabledTools.length}
          enabledSkillsCount={p.enabledSkills.length}
          onOpenAdvanced={() => p.setAdvancedOpen(true)}
          onOpenKeyboardShortcuts={() => p.setKeyboardShortcutsOpen(true)}
          error={p.error}
          onToggleMemory={async () => {
            try {
              const next = !p.conversation?.memoryDisabled;
              const res = await fetch(`/api/conversations/${conversationId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ memoryDisabled: next }),
              });
              if (res.ok) {
                p.setConversation((prev: any) =>
                  prev ? { ...prev, memoryDisabled: next } : null,
                );
              }
            } catch (e) {
              console.error("Failed to toggle memory:", e);
              p.toast("Failed to toggle memory", "error");
            }
          }}
        />

        <div className="relative flex-1 flex min-h-0">
          {p.messages.length === 0 && !p.isLoading && (
            <EmptyState modelName={p.currentModelName} />
          )}

          {p.messages.length > 0 && (
            <ChatMessages
              messages={p.messages}
              isLoading={p.isLoading}
              onEditMessage={p.handleEditMessage}
              onDeleteMessage={p.handleDeleteMessage}
              onCopyMessage={p.handleCopyMessage}
              onRegenerateMessage={p.handleRegenerateMessage}
              onOpenArtifact={(id: string) => { p.setSelectedArtifactId(id); p.setArtifactPanelOpen(true); }}
              onClarificationAnswer={p.handleClarificationAnswer}
              scrollRef={p.scrollRef}
            />
          )}

          {p.messages.length > 0 && (
            <MinimapNavigator
              scrollRef={p.scrollRef}
              messages={p.minimapMessages}
            />
          )}

          <TodoIndicator
            conversationId={conversationId}
            onOpen={() => p.setTodoPanelOpen(true)}
          />
        </div>

        <ChatInput
          input={p.input}
          setInput={p.setInput}
          files={p.files}
          setFiles={p.setFiles}
          isLoading={p.isLoading}
          onSubmit={p.handleSubmit}
          onStop={p.stop}
          onRetry={p.handleRegenerate}
          kbId={p.selectedKbId}
          contextUsage={p.contextData}
          onContextClick={() => p.setContextPanelOpen(true)}
          isCompressed={!!p.conversation?.compressedSummary}
          isCompressing={p.isCompressing}
          model={p.conversation.model}
          onModelChange={p.handleModelChange}
          onOpenSettings={() => p.setModelSettingsOpen(true)}
          onKbToggle={p.handleKbToggle}
          searchProvider={p.searchProvider}
          onToggleSearchProvider={p.toggleSearchProvider}
        />
      </main>
      <ArtifactPanel
        conversationId={conversationId}
        isOpen={p.artifactPanelOpen}
        onClose={() => p.setArtifactPanelOpen(false)}
        selectedId={p.selectedArtifactId}
        onSelect={(id: string | null) => p.setSelectedArtifactId(id)}
      />
      <Scratchpad
        isOpen={p.scratchpadOpen}
        onClose={() => p.setScratchpadOpen(false)}
        conversationId={conversationId}
      />
      <GoalPanel
        isOpen={p.goalPanelOpen}
        onClose={() => p.setGoalPanelOpen(false)}
        conversationId={conversationId}
        model={p.conversation.model}
        kickoff={p.goalKickoff}
        onComplete={() => { p.refreshConversationAndMessages(); }}
      />
      <TodoPanel
        isOpen={p.todoPanelOpen}
        onClose={() => p.setTodoPanelOpen(false)}
        conversationId={conversationId}
      />
      <AdvancedSettings
        isOpen={p.advancedOpen}
        onClose={() => p.setAdvancedOpen(false)}
        enabledTools={p.enabledTools}
        enabledSkills={p.enabledSkills}
        onChange={p.persistAdvanced}
      />
      <ModelSettingsDialog
        isOpen={p.modelSettingsOpen}
        onClose={() => p.setModelSettingsOpen(false)}
        conversationId={conversationId}
        currentModel={p.conversation.model}
        currentSystemPrompt={p.conversation.systemPrompt || ""}
        currentTemperature={p.conversation.temperature}
        currentContextLength={p.conversation.contextLength}
        currentTopP={p.conversation.topP}
        currentMaxTokens={p.conversation.maxTokens}
        currentChatOnlyMode={p.conversation.chatOnlyMode || false}
        currentKbId={p.selectedKbId || null}
        currentMaxToolCalls={p.conversation.maxToolCalls}
        currentFallbackModel={p.conversation.fallbackModel || null}
        onSave={p.handleModelSettingsSave}
      />
      <ContextDetailsPanel
        isOpen={p.contextPanelOpen}
        onClose={() => p.setContextPanelOpen(false)}
        conversationId={conversationId}
        model={p.conversation.model}
        contextLength={p.conversation.contextLength || 8192}
        currentMessage={p.input}
        messages={p.messages.map((m: any) => ({
          role: m.role,
          content: joinTextParts(m.parts),
        }))}
        enabledTools={p.enabledTools}
        enabledSkills={p.enabledSkills}
        kbId={p.selectedKbId}
        hasCompressedSummary={!!p.conversation.compressedSummary}
        onCompressed={async () => { await p.refreshConversationAndMessages(); }}
        onCleared={async () => { await p.refreshConversationAndMessages(); }}
      />
      <ToolErrorDialog
        isOpen={p.toolErrorDialogOpen}
        onClose={() => p.setToolErrorDialogOpen(false)}
        onEnableChatOnlyMode={async () => {
          try {
            const res = await fetch(`/api/conversations/${conversationId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chatOnlyMode: true }),
            });
            if (res.ok) {
              p.setConversation((prev: any) =>
                prev ? { ...prev, chatOnlyMode: true } : null,
              );
              p.setToolErrorDialogOpen(false);
            }
          } catch (e) {
            console.error("Failed to enable chat-only mode:", e);
            p.toast("Failed to enable chat-only mode", "error");
          }
        }}
        modelName={(p.conversation?.model || "current model").split("/").pop() || ""}
      />
      <RegenerationOptions
        isOpen={p.regenModal !== null}
        onClose={() => p.setRegenModal(null)}
        onExecute={p.handleRegenExecute}
      />
      <KeyboardShortcutsDialog
        isOpen={p.keyboardShortcutsOpen}
        onClose={() => p.setKeyboardShortcutsOpen(false)}
      />
    </div>
  );
}
