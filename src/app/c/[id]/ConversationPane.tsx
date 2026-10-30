"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PaneBar from "@/app/c/PaneBar";
import SideChatHeader from "@/app/components/sidechat/SideChatHeader";
import SideComposer from "@/app/components/sidechat/SideComposer";
import { sideChatTitle } from "@/lib/chat/sideChatLabels";
import { AgentTalkingRow } from "@/app/components/AgentMessageBubble";
import { AgentSendContext } from "@/app/components/MessageActions";
import { createSideChat, listSideChats, type SideChatSummary } from "@/lib/sideChat";
import { useSplitViewOptional } from "@/app/c/SplitViewContext";
import { isPaneBusy } from "@/lib/splitPanes";

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
import { ChatModeContext } from "@/app/contexts/ChatModeContext";
import { joinTextParts } from "@/lib/utils/conversation";
import { exportChat } from "@/lib/utils/download";
import { StickyNote, FileCode, SlidersHorizontal, Settings, BarChart3, Target, Download, History, Minimize2, Columns2 } from "lucide-react";

import { useChatPane } from "./useChatPane";

interface Props {
  conversationId: string;
  /** Only a focused pane answers shortcuts and shows its palette actions. */
  focused: boolean;
  initialPrompt?: string;
  searchProvider: "duckduckgo" | "tavily";
  onToggleSearchProvider: () => void;
  /** Side chats: wide (half the row) rather than compact. */
  sideWide?: boolean;
  onToggleSideWide?: () => void;
}

/** One chat: header, transcript, composer and panels. Its state lives in useChatPane. */
export default function ConversationPane({ conversationId, focused, initialPrompt, searchProvider, onToggleSearchProvider, sideWide = false, onToggleSideWide }: Props) {
  const p = useChatPane(conversationId, { focused, kind: "chat", searchProvider, initialPrompt });
  const split = useSplitViewOptional();
  const setPaneBusy = split?.setPaneBusy;
  // The split view asks before it closes or replaces a busy pane.
  const busy = isPaneBusy({
    streaming: p.isLoading,
    input: p.input,
    quotes: p.quotes.length,
    files: p.files.length + p.mentions.length,
    queued: p.queued.length,
  });
  useEffect(() => { setPaneBusy?.(conversationId, busy); }, [conversationId, busy, setPaneBusy]);
  useEffect(() => () => setPaneBusy?.(conversationId, false), [conversationId, setPaneBusy]);

  // A side chat: a floating card with its own header, a plain transcript and a one-box composer.
  const isSide = p.conversation?.kind === "side";
  const firstUserText = useMemo(() => {
    const first = p.messages.find((m) => m.role === "user");
    return first ? joinTextParts(first.parts) : "";
  }, [p.messages]);
  // A sub-agent transcript: read only, and never a target for sendToChat.
  const isSub = p.isSubagent;
  const parentId = p.conversation?.parentId ?? null;
  const parentTitle = (parentId && split?.info[parentId]?.title) || "Main chat";
  const setPaneKind = split?.setPaneKind;
  useEffect(() => {
    if (p.conversation) setPaneKind?.(conversationId, isSub ? "subagent" : isSide ? "side" : "chat");
  }, [conversationId, p.conversation, isSub, isSide, setPaneKind]);
  const talk = split?.talk[conversationId];
  // Tool-less models have no sendToChat: their replies get a "Send to…" menu over the other open chats.
  // A sub-agent transcript is read only, so it sends nowhere.
  const sendTargets = useMemo(
    () => (isSub || p.toolsAvailable ? [] : (split?.chatPanes ?? []).filter((x) => x.id !== conversationId).map((x) => ({ id: x.id, title: x.title.trim() || (x.kind === "side" ? "Side chat" : "Untitled chat") }))),
    [isSub, p.toolsAvailable, split?.chatPanes, conversationId],
  );
  const sendToPane = p.sendToPane;
  const agentSend = useMemo(() => ({ targets: sendTargets, send: sendToPane }), [sendTargets, sendToPane]);
  const [sideHistory, setSideHistory] = useState<SideChatSummary[]>([]);
  useEffect(() => {
    if (!isSide || !parentId) return;
    listSideChats(parentId).then(setSideHistory).catch(() => {});
  }, [isSide, parentId]);

  // Closing a pane stops its stream; unmounting alone does not (the server finishes and saves).
  const registerStop = split?.registerStop;
  const setPaneCaps = split?.setPaneCaps;
  const setPaneParent = split?.setPaneParent;
  const stopRef = useRef(p.stop);
  useEffect(() => { stopRef.current = p.stop; });
  useEffect(() => {
    registerStop?.(conversationId, () => stopRef.current());
    return () => registerStop?.(conversationId, null);
  }, [conversationId, registerStop]);
  useEffect(() => { setPaneCaps?.(conversationId, p.modelCaps); }, [conversationId, p.modelCaps, setPaneCaps]);
  useEffect(() => {
    setPaneParent?.(conversationId, isSide && parentId ? parentId : null);
    return () => setPaneParent?.(conversationId, null);
  }, [conversationId, isSide, parentId, setPaneParent]);

  const panelActions = [
    { id: "scratchpad", label: "Open Scratchpad", icon: <StickyNote size={16} />, onSelect: () => p.setScratchpadOpen(true) },
    { id: "artifacts", label: "Open Artifacts", icon: <FileCode size={16} />, onSelect: () => p.setArtifactPanelOpen(true) },
    { id: "advanced-settings", label: "Advanced Settings", icon: <SlidersHorizontal size={16} />, onSelect: () => p.setAdvancedOpen(true) },
    { id: "model-settings", label: "Model Settings", icon: <Settings size={16} />, onSelect: () => p.setModelSettingsOpen(true) },
    { id: "context", label: "Context Usage", icon: <BarChart3 size={16} />, onSelect: () => p.setContextPanelOpen(true) },
  ];
  useCommandPaletteActions(focused ? "Panels" : "Panels (idle)", focused ? panelActions : []);

  const chatActions = [
    { id: "export-markdown", label: "Export as Markdown", icon: <Download size={16} />, onSelect: () => exportChat(conversationId, "markdown", p.toast) },
    { id: "search-past-chats", label: "Search past chats", icon: <History size={16} />, onSelect: () => p.setInput("/recall ") },
    { id: "compress-chat", label: "Compress chat", icon: <Minimize2 size={16} />, onSelect: () => p.setInput("/compress ") },
    { id: "toggle-side-chat", label: "Toggle side chat", icon: <Columns2 size={16} />, onSelect: () => p.toggleSidePane() },
  ];
  useCommandPaletteActions(focused ? "Chat" : "Chat (idle)", focused ? chatActions : []);

  // The bar stays in the loading and missing states too, so a pane can always be closed.
  const bar = split?.multi && !isSide ? (
    <PaneBar
      title={split.info[conversationId]?.title ?? "Chat"}
      focused={focused}
      onClose={() => split.closeChat(conversationId)}
      warning={split.warnings[conversationId]}
      onWarningClick={() => split.focusPane(split.warnings[conversationId]?.otherId ?? conversationId)}
    />
  ) : null;

  if (p.loading) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col">
        {bar}
        <div className="flex flex-1 items-center justify-center bg-[var(--background)] text-[var(--foreground)]">
          <div className="glass-card rounded-[var(--glass-radius-xl)] px-8 py-6 backdrop-blur-[var(--glass-blur-lg)]">
            Loading conversation...
          </div>
        </div>
      </div>
    );
  }

  if (!p.conversation) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col">
        {bar}
        <div className="flex flex-1 items-center justify-center bg-[var(--background)] text-[var(--foreground)]">
          <div className="glass-card rounded-[var(--glass-radius-xl)] px-8 py-6">
            This chat no longer exists
          </div>
        </div>
      </div>
    );
  }

  return (
    <ChatModeContext.Provider value={{ mode: p.mode, setMode: p.setMode, modelCaps: p.modelCaps, setModelCaps: p.setModelCaps }}>
    <div className="flex h-full bg-[var(--background)]">
      <main
        className={
          isSide
            ? "m-2 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--glass-radius-lg)] border border-[var(--glass-border)] bg-[var(--glass-bg-elevated)] text-[var(--foreground)] shadow-[var(--glass-shadow-sm)]"
            : "flex h-full flex-1 min-w-0 flex-col bg-[var(--background)] text-[var(--foreground)]"
        }
      >
        {split?.multi && !isSide && (
          <PaneBar
            title={split.info[conversationId]?.title ?? "Chat"}
            focused={focused}
            onClose={() => split.closeChat(conversationId)}
            warning={split.warnings[conversationId]}
            onWarningClick={() => split.focusPane(split.warnings[conversationId]?.otherId ?? conversationId)}
          />
        )}
        <div aria-live="polite" className="sr-only">{p.announcement}</div>
        {isSub ? (
          <SubAgentBanner
            parentTitle={parentTitle}
            onOpenParent={() => {
              if (!parentId) return;
              if (split?.ids.includes(parentId)) split.focusPane(parentId);
              else split?.replaceFocused(parentId);
            }}
          />
        ) : isSide ? (
          parentId && (
            <SideChatHeader
              title={sideChatTitle(p.conversation?.title, firstUserText)}
              history={sideHistory}
              activeId={conversationId}
              onSelect={(id) => split?.replaceAt(conversationId, id)}
              onNewSideChat={async () => split?.replaceAt(conversationId, (await createSideChat(parentId)).id)}
              onClose={() => split?.closeChat(conversationId)}
              expanded={sideWide}
              onToggleExpanded={() => onToggleSideWide?.()}
            />
          )
        ) : (
        <ConversationHeader
          allowedToolCount={p.allowedToolCount}
          onResetAllowedTools={p.resetAllowedTools}
          conversation={p.conversation}
          messagesCount={p.messages.length}
          scratchpadOpen={p.scratchpadOpen}
          onToggleScratchpad={() => p.setScratchpadOpen((v: boolean) => !v)}
          artifactsOpen={p.artifactPanelOpen}
          onToggleArtifacts={() => p.setArtifactPanelOpen((v: boolean) => !v)}
          sideOpen={!!split?.ids.some((id) => split.parentOf[id] === conversationId)}
          onToggleSide={isSub || !split ? undefined : p.toggleSidePane}
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
        )}

        <div className="relative flex-1 flex min-h-0">
          {p.messages.length === 0 && !p.isLoading && (
            <EmptyState modelName={p.currentModelName} temporary={p.conversation.temporary} sideOf={isSide ? parentTitle : undefined} />
          )}

          {p.messages.length > 0 && (
            <AgentSendContext.Provider value={agentSend}>
            <ToolAnswersProvider value={{ answerApproval: p.answerApproval, answerPlan: p.answerPlan }}>
            <ChatMessages
              messages={p.messages}
              isLoading={p.isLoading}
              onEditMessage={isSub || isSide ? undefined : p.handleEditMessage}
              onDeleteMessage={isSub || isSide ? undefined : p.handleDeleteMessage}
              onCopyMessage={p.handleCopyMessage}
              onForkMessage={isSub || isSide ? undefined : p.handleForkMessage}
              onRegenerateMessage={isSub || isSide ? undefined : p.handleRegenerateMessage}
              onOpenArtifact={(id: string) => { p.setSelectedArtifactId(id); p.setArtifactPanelOpen(true); }}
              onClarificationAnswer={p.handleClarificationAnswer}
              onApprovePlan={p.mode === "plan" && !p.toolsAvailable ? p.approvePlanReply : undefined}
              toolsAvailable={p.toolsAvailable}
              scrollRef={p.scrollRef}
              statusLabel={p.currentModelName ? `Waiting for ${p.currentModelName}…` : undefined}
              onQuote={p.addQuote}
              quoteSuppressed={isSub || p.isDialogOpen}
              sendToMain={isSide && parentId ? { title: parentTitle, onSend: (text: string) => window.dispatchEvent(new CustomEvent("vas:send-to-main", { detail: { id: parentId, text } })) } : undefined}
              compact={isSide}
            />
            </ToolAnswersProvider>
            </AgentSendContext.Provider>
          )}

          {p.messages.length > 0 && !isSide && (
            <MinimapNavigator
              scrollRef={p.scrollRef}
              messages={p.minimapMessages}
            />
          )}

          {!isSide && (
            <TodoIndicator
              conversationId={conversationId}
              onOpen={() => p.setTodoPanelOpen(true)}
            />
          )}
          {/* Overlaid on the top of the list, so the list does not move when agents start or stop talking. */}
          {talk && (
            <div className="glass-card absolute inset-x-0 top-0 z-10 mx-4 mt-2 rounded-[var(--glass-radius-md)] px-3 py-2">
              <AgentTalkingRow withTitle={split?.info[talk.withId]?.title ?? ""} hop={talk.hop} onStop={() => split?.stopAgents()} />
            </div>
          )}
        </div>
        {!isSub && isSide && (
          <SideComposer
            autoFocus={focused}
            input={p.input}
            setInput={p.setInput}
            parentTitle={parentTitle}
            isLoading={p.isLoading}
            onSubmit={() => p.handleSubmit()}
            onStop={p.stop}
            onQueue={p.queueMessage}
            queued={p.queued}
            toolsAvailable={p.toolsAvailable}
            onQueueEdit={p.editQueued}
            onQueueRemove={p.removeQueued}
            onQueueRetry={p.retryQueued}
          />
        )}
        {!isSub && !isSide && (
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
          mode={p.mode}
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
          searchProvider={searchProvider}
          onToggleSearchProvider={onToggleSearchProvider}
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
        )}
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
    </ChatModeContext.Provider>
  );
}

/** The header of a sub-agent transcript: it says so, and links back to the chat that ran it. */
function SubAgentBanner({ parentTitle, onOpenParent }: { parentTitle: string; onOpenParent: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-[var(--glass-border)] px-4 py-2 text-xs text-zinc-400">
      <span>Sub-agent transcript · read only</span>
      <button type="button" onClick={onOpenParent} className="focus-ring ml-auto truncate underline hover:text-[var(--foreground)]">
        {`Back to ${parentTitle}`}
      </button>
    </div>
  );
}
