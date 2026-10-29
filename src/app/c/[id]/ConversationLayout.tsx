"use client";

import ChatMessages from "@/app/components/ChatMessages";
import MinimapNavigator from "@/app/components/MinimapNavigator";
import ChatInput from "@/app/components/chatInput";
import Scratchpad from "@/app/components/Scratchpad";
import ArtifactPanel from "@/app/components/ArtifactPanel";
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
import { ToolAnswersProvider } from "@/app/components/ToolAnswers";
import { useKeyboardShortcuts } from "@/app/hooks/useKeyboardShortcuts";
import { joinTextParts } from "@/lib/utils/conversation";
import { exportChat } from "@/lib/utils/download";
import { StickyNote, FileCode, SlidersHorizontal, Settings, BarChart3, Target, Download, History, Minimize2 } from "lucide-react";

import { useConversationPage } from "./useConversationPage";

interface Props {
  conversationId: string;
  initialPrompt?: string;
}

export default function ConversationLayout({ conversationId, initialPrompt }: Props) {
  const p = useConversationPage(conversationId, initialPrompt);

  useCommandPaletteActions("Panels", [
    { id: "scratchpad", label: "Open Scratchpad", icon: <StickyNote size={16} />, onSelect: () => p.setScratchpadOpen(true) },
    { id: "artifacts", label: "Open Artifacts", icon: <FileCode size={16} />, onSelect: () => p.setArtifactPanelOpen(true) },
    { id: "advanced-settings", label: "Advanced Settings", icon: <SlidersHorizontal size={16} />, onSelect: () => p.setAdvancedOpen(true) },
    { id: "model-settings", label: "Model Settings", icon: <Settings size={16} />, onSelect: () => p.setModelSettingsOpen(true) },
    { id: "context", label: "Context Usage", icon: <BarChart3 size={16} />, onSelect: () => p.setContextPanelOpen(true) },
  ]);

  useCommandPaletteActions("Chat", [
    { id: "export-markdown", label: "Export as Markdown", icon: <Download size={16} />, onSelect: () => exportChat(conversationId, "markdown", p.toast) },
    { id: "search-past-chats", label: "Search past chats", icon: <History size={16} />, onSelect: () => p.setInput("/recall ") },
    { id: "compress-chat", label: "Compress chat", icon: <Minimize2 size={16} />, onSelect: () => p.setInput("/compress ") },
  ]);

  useKeyboardShortcuts({
    onSend: () => p.handleSubmit(),
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
          This chat no longer exists
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[var(--background)]">
      <main className="flex h-screen flex-1 min-w-0 flex-col bg-[var(--background)] text-[var(--foreground)]">
        <div aria-live="polite" className="sr-only">{p.announcement}</div>
        <ConversationHeader
          allowedToolCount={p.allowedToolCount}
          onResetAllowedTools={p.resetAllowedTools}
          conversation={p.conversation}
          messagesCount={p.messages.length}
          scratchpadOpen={p.scratchpadOpen}
          onToggleScratchpad={() => p.setScratchpadOpen((v: boolean) => !v)}
          artifactsOpen={p.artifactPanelOpen}
          onToggleArtifacts={() => p.setArtifactPanelOpen((v: boolean) => !v)}
          enabledToolsCount={p.enabledTools.length}
          enabledSkillsCount={p.enabledSkills.length}
          onOpenAdvanced={() => p.setAdvancedOpen(true)}
          onOpenKeyboardShortcuts={() => p.setKeyboardShortcutsOpen(true)}
          error={p.error}
          onToggleTemporary={p.toggleTemporary}
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
            <EmptyState modelName={p.currentModelName} temporary={p.conversation.temporary} />
          )}

          {p.messages.length > 0 && (
            <ToolAnswersProvider value={{ answerApproval: p.answerApproval, answerPlan: p.answerPlan }}>
            <ChatMessages
              messages={p.messages}
              isLoading={p.isLoading}
              onEditMessage={p.handleEditMessage}
              onDeleteMessage={p.handleDeleteMessage}
              onCopyMessage={p.handleCopyMessage}
              onForkMessage={p.handleForkMessage}
              onRegenerateMessage={p.handleRegenerateMessage}
              onOpenArtifact={(id: string) => { p.setSelectedArtifactId(id); p.setArtifactPanelOpen(true); }}
              onClarificationAnswer={p.handleClarificationAnswer}
              onApprovePlan={p.mode === "plan" && !p.toolsAvailable ? p.approvePlanReply : undefined}
              toolsAvailable={p.toolsAvailable}
              scrollRef={p.scrollRef}
              statusLabel={p.currentModelName ? `Waiting for ${p.currentModelName}…` : undefined}
              onQuote={p.addQuote}
              quoteSuppressed={p.isDialogOpen}
            />
            </ToolAnswersProvider>
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
          conversationId={conversationId}
          mentions={p.mentions}
          setMentions={p.setMentions}
          mentionCuts={p.mentionCuts}
          isLoading={p.isLoading}
          onSubmit={p.handleSubmit}
          onStop={p.stop}
          kbId={p.selectedKbId}
          contextUsage={p.contextData}
          onContextClick={() => p.setContextPanelOpen(true)}
          isCompressed={!!p.conversation?.compressedSummary}
          isCompressing={p.isCompressing}
          compressFocus={p.compressFocus}
          model={p.conversation.model}
          onModelChange={p.handleModelChange}
          workingFolder={p.conversation.workingFolder ?? null}
          onWorkingFolderChange={p.handleWorkingFolderChange}
          onOpenSettings={() => p.setModelSettingsOpen(true)}
          onKbToggle={p.handleKbToggle}
          searchProvider={p.searchProvider}
          onToggleSearchProvider={p.toggleSearchProvider}
          suggestion={p.suggestion}
          onAcceptSuggestion={() => {
            if (p.suggestion) p.setInput(p.suggestion);
            p.setSuggestion(null);
          }}
          quotes={p.quotes}
          onQuoteChange={p.updateQuote}
          onQuoteRemove={p.removeQuote}
          onSendQuote={p.sendQuote}
          temporary={p.conversation.temporary}
          queued={p.queued}
          onQueue={p.queueMessage}
          onQueueEdit={p.editQueued}
          onQueueRemove={p.removeQueued}
          onQueueRetry={p.retryQueued}
          toolsAvailable={p.toolsAvailable}
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
        currentPersona={p.conversation.persona || null}
        currentReasoningEffort={p.conversation.reasoningEffort ?? null}
        currentWorkingFolder={p.conversation.workingFolder ?? null}
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
