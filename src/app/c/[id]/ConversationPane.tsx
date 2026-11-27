"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PaneBar from "@/app/c/PaneBar";
import SideChatHeader from "@/app/components/sidechat/SideChatHeader";
import SideComposer from "@/app/components/sidechat/SideComposer";
import { sideChatTitle } from "@/lib/chat/sideChatLabels";
import { AgentTalkingRow } from "@/app/components/AgentMessageBubble";
import { RunScope } from "@/app/components/CodeRunner";
import { AgentSendContext } from "@/app/components/MessageActions";
import { createSideChat, listSideChats, type SideChatSummary } from "@/lib/sideChat";
import { useSplitViewOptional } from "@/app/c/SplitViewContext";
import { isPaneBusy } from "@/lib/splitPanes";

import ChatMessages from "@/app/components/ChatMessages";
import MinimapNavigator from "@/app/components/MinimapNavigator";
import ChatInput from "@/app/components/chatInput";
import BridgeNotice from "@/app/components/BridgeNotice";
import Scratchpad from "@/app/components/Scratchpad";
import ArtifactPanel from "@/app/components/ArtifactPanel";
import TodoPanel from "@/app/components/TodoPanel";
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
import { Activity, SlidersHorizontal, Settings, Download, History, Minimize2, Columns2 } from "lucide-react";
import ActivityPopover, { ActivityButton } from "@/app/components/conversation/ActivityPopover";
import PanelLauncher from "@/app/components/conversation/PanelLauncher";
import ChatSidePanel from "@/app/components/panel/ChatSidePanel";
import TasksView from "@/app/components/panel/TasksView";
import ConnectorsView from "@/app/components/panel/ConnectorsView";
import FilesView from "@/app/components/panel/FilesView";
import { VIEW_META, VIEW_ORDER } from "@/app/components/panel/panelViews";
import { usePanel } from "@/app/components/panel/usePanel";
import { useTodoSummary } from "@/app/components/panel/useTodoSummary";
import { useAltShortcuts } from "@/app/hooks/useKeyboardShortcuts";
import { useFolders } from "@/app/hooks/useFolders";
import { runningCount, tasksFrom } from "@/lib/chat/backgroundTasks";
import { markTabTitle } from "@/lib/tabTitle";
import { parsePanel, type PanelView } from "@/lib/chatPanel";

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
  // Where a side chat can open from here: a main chat on a screen wide enough for two panes.
  const canSide = !isSub && !isSide && !!split && split.limit > 1;
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

  const panel = usePanel(conversationId);
  const { hostTools } = useFolders();
  const canPanel = !isSub && !isSide;
  const hasFiles = canPanel && hostTools && !!p.conversation?.workingFolder;
  const [activityOpen, setActivityOpen] = useState(false);
  // Set when the bridge opens the panel by itself, so the panel does not take focus from the composer mid-reply.
  const quietOpen = useRef(false);
  // A side chat or a sub-agent transcript has no docked panel: its artifacts open in the full-screen Outputs overlay.
  const [outputsOverlay, setOutputsOverlay] = useState(false);

  // ponytail: bridge; fold into useChatPane once the tool-approval branch lands
  // The old open-flags (slash commands, artifact cards, the context ring, a new artifact) now open a panel view and reset.
  const { artifactPanelOpen, takeArtifactFromReply, contextPanelOpen, scratchpadOpen, todoPanelOpen, selectedArtifactId } = p;
  const { setArtifactPanelOpen, setContextPanelOpen, setScratchpadOpen, setTodoPanelOpen } = p;
  const splitIds = split?.ids;
  const openView = panel.open;
  const panelOpen = !!panel.panel;
  // The flag lasts until the panel closes, so a user's next open takes focus.
  useEffect(() => {
    if (!panelOpen) quietOpen.current = false;
  }, [panelOpen]);
  useEffect(() => {
    // Only a finished reply opens Outputs by itself; a card click, /artifacts and the other flags are the user's.
    const replyMark = takeArtifactFromReply();
    const fromReply = artifactPanelOpen && replyMark;
    const view: PanelView | null = artifactPanelOpen ? "outputs" : contextPanelOpen ? "context" : scratchpadOpen ? "notes" : todoPanelOpen ? "todos" : null;
    if (!view) return;
    if (canPanel) {
      // The reply's open skips a pane that is not focused when another pane's chat holds the panel: that pane is the user's.
      const owner = parsePanel(new URLSearchParams(window.location.search), splitIds ?? [conversationId])?.owner;
      const ownedElsewhere = !!owner && owner !== conversationId;
      if (!fromReply || focused || !ownedElsewhere) {
        // A reply's open stays quiet (focus stays in the composer); a user's open takes focus.
        quietOpen.current = fromReply;
        openView(view, view === "outputs" ? selectedArtifactId : null);
      }
    }
    setArtifactPanelOpen(false);
    setContextPanelOpen(false);
    setScratchpadOpen(false);
    setTodoPanelOpen(false);
  }, [artifactPanelOpen, takeArtifactFromReply, contextPanelOpen, scratchpadOpen, todoPanelOpen, selectedArtifactId, canPanel, focused, splitIds, conversationId, openView, setArtifactPanelOpen, setContextPanelOpen, setScratchpadOpen, setTodoPanelOpen]);

  // Background tasks: the reply's start time is not in the messages, so note it when the reply begins.
  const [replyStartedAt, setReplyStartedAt] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- records when a reply starts
    setReplyStartedAt(p.isLoading ? Date.now() : null);
  }, [p.isLoading]);
  const talkTitle = talk ? split?.info[talk.withId]?.title ?? "" : "";
  const tasks = useMemo(
    () => tasksFrom(p.messages, p.isLoading, p.queued.filter((q) => q.status !== "claimed"), talk ? { withTitle: talkTitle, hop: talk.hop } : undefined, replyStartedAt),
    [p.messages, p.isLoading, p.queued, talk, talkTitle, replyStartedAt],
  );
  const todos = useTodoSummary(conversationId, canPanel);
  const activeCount = runningCount(tasks) + todos.open;

  // A tab in the background learns that a reply finished.
  const wasLoading = useRef(false);
  useEffect(() => {
    if (wasLoading.current && !p.isLoading && document.hidden) markTabTitle();
    wasLoading.current = p.isLoading;
  }, [p.isLoading]);

  const toggleMemory = async () => {
    try {
      const next = !p.conversation?.memoryDisabled;
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memoryDisabled: next }),
      });
      if (res.ok) {
        p.setConversation((prev: any) => (prev ? { ...prev, memoryDisabled: next } : null));
      }
    } catch (e) {
      console.error("Failed to toggle memory:", e);
      p.toast("Failed to toggle memory", "error");
    }
  };

  // The composer's pickers, found by their data attributes; without them (small screens) Model Settings opens instead.
  const pickerIn = (attr: string) => {
    const el = document.querySelector<HTMLElement>(`[data-pane-id="${conversationId}"] [${attr}]`);
    return el && el.offsetParent ? el : null;
  };
  const focusModel = (open = false) => {
    const el = pickerIn("data-model-picker");
    if (!el) return p.setModelSettingsOpen(true);
    el.focus();
    if (open) el.click();
  };
  const focusFolder = () => {
    const el = pickerIn("data-folder-picker");
    if (el) el.focus();
    else p.setModelSettingsOpen(true);
  };

  const sideToggle = isSub || !split ? undefined : p.toggleSidePane;
  const viewKey = (v: PanelView) => (hasFiles || v !== "files" ? () => openView(v) : undefined);
  useAltShortcuts(
    focused && canPanel
      ? {
          A: () => setActivityOpen((v) => !v),
          P: panel.toggle,
          M: () => focusModel(true),
          "1": sideToggle,
          ...Object.fromEntries(VIEW_ORDER.map((v, i) => [String(i + 2), viewKey(v)])),
        }
      : undefined,
  );

  const panelActions = [
    ...(canPanel
      ? [
          { id: "activity", label: "Open Activity", icon: <Activity size={16} />, onSelect: () => setActivityOpen(true) },
          ...VIEW_ORDER.filter((v) => v !== "files" || hasFiles).map((v) => {
            const { icon: Icon, palette } = VIEW_META[v];
            return { id: `panel-${v}`, label: palette, icon: <Icon size={16} />, onSelect: () => openView(v) };
          }),
        ]
      : []),
    { id: "advanced-settings", label: "Advanced Settings", icon: <SlidersHorizontal size={16} />, onSelect: () => p.setAdvancedOpen(true) },
    { id: "model-settings", label: "Model Settings", icon: <Settings size={16} />, onSelect: () => p.setModelSettingsOpen(true) },
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

  // The panel shows Files only with a folder and host tools; a stale ?panel=files falls back to Outputs.
  const view: PanelView = panel.panel?.view === "files" && !hasFiles ? "outputs" : (panel.panel?.view ?? "outputs");
  const panelItem = panel.panel?.item ?? null;
  const panelBody = (() => {
    switch (view) {
      case "context":
        return (
          <ContextDetailsPanel
            isOpen
            onClose={panel.close}
            conversationId={conversationId}
            model={p.conversation.model}
            contextLength={p.conversation.contextLength || 8192}
            currentMessage={p.input}
            messages={p.messages.map((m: any) => ({ role: m.role, content: joinTextParts(m.parts) }))}
            enabledTools={p.enabledTools}
            enabledSkills={p.enabledSkills}
            kbId={p.selectedKbId}
            hasCompressedSummary={!!p.conversation.compressedSummary}
            onCompressed={async () => { await p.refreshConversationAndMessages(); }}
            onCleared={async () => { await p.refreshConversationAndMessages(); }}
          />
        );
      case "outputs":
        return <ArtifactPanel conversationId={conversationId} isOpen onClose={panel.close} selectedId={panelItem} onSelect={(id: string | null) => openView("outputs", id)} />;
      case "notes":
        return <Scratchpad isOpen onClose={panel.close} conversationId={conversationId} />;
      case "todos":
        return <TodoPanel isOpen onClose={panel.close} conversationId={conversationId} />;
      case "tasks":
        return (
          <TasksView
            tasks={tasks}
            messages={p.messages}
            isLoading={p.isLoading}
            item={panelItem}
            onStopReply={p.stop}
            onRemoveQueued={(id) => void p.removeQueued(id)}
            onStopAgents={() => split?.stopAgents()}
          />
        );
      case "connectors":
        return <ConnectorsView />;
      case "files":
        return <FilesView conversationId={conversationId} onMention={(path) => p.setMentions((prev: string[]) => (prev.includes(path) ? prev : [...prev, path]))} />;
    }
  })();

  return (
    <ChatModeContext.Provider value={{ mode: p.mode, setMode: p.setMode, modelCaps: p.modelCaps, setModelCaps: p.setModelCaps }}>
    <RunScope.Provider value={conversationId}>
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
          enabledToolsCount={p.enabledTools.length}
          enabledSkillsCount={p.enabledSkills.length}
          onOpenAdvanced={() => p.setAdvancedOpen(true)}
          onOpenKeyboardShortcuts={() => p.setKeyboardShortcutsOpen(true)}
          error={p.error}
          onToggleTemporary={p.toggleTemporary}
          showSidebarToggle={!split?.multi || split.ids[0] === conversationId || !split.sideBySide}
          activity={
            <div className="sm:relative">
              <ActivityButton open={activityOpen} count={activeCount} onClick={() => setActivityOpen((v) => !v)} />
              {activityOpen && (
                <ActivityPopover
                  conversationId={conversationId}
                  modelName={p.currentModelName ?? ""}
                  folder={p.conversation.workingFolder ?? null}
                  hostTools={hostTools}
                  temporary={!!p.conversation.temporary}
                  memoryOn={!p.conversation.memoryDisabled}
                  onToggleMemory={toggleMemory}
                  context={p.contextData}
                  tasks={tasks}
                  todosOpen={todos.open}
                  onOpenView={(view, item) => openView(view, item)}
                  onFocusModel={() => focusModel()}
                  onFocusFolder={focusFolder}
                  onStopReply={p.stop}
                  onRemoveQueued={(id) => void p.removeQueued(id)}
                  onStopAgents={() => split?.stopAgents()}
                  onClose={() => setActivityOpen(false)}
                />
              )}
            </div>
          }
          launcher={
            <PanelLauncher
              onToggleSide={sideToggle}
              sideOpen={!!split?.ids.some((id) => split.parentOf[id] === conversationId)}
              hasFiles={hasFiles}
              runningTasks={runningCount(tasks)}
              activeView={panel.panel?.view ?? null}
              onOpenView={(v) => openView(v)}
            />
          }
        />
        )}

        <div className="relative flex-1 flex min-h-0">
          {p.messages.length === 0 && !p.isLoading && (
            <EmptyState modelName={p.currentModelName} temporary={p.conversation.temporary} sideOf={isSide ? parentTitle : undefined} />
          )}

          {p.messages.length > 0 && (
            <AgentSendContext.Provider value={agentSend}>
            <ToolAnswersProvider value={{ answerApproval: p.answerApproval, answerPlan: p.answerPlan, model: p.conversation.model }}>
            <ChatMessages
              messages={p.messages}
              isLoading={p.isLoading}
              onEditMessage={isSub || isSide ? undefined : p.handleEditMessage}
              onDeleteMessage={isSub || isSide ? undefined : p.handleDeleteMessage}
              onCopyMessage={p.handleCopyMessage}
              onForkMessage={isSub || isSide ? undefined : p.handleForkMessage}
              onRegenerateMessage={isSub || isSide ? undefined : p.handleRegenerateMessage}
              onOpenArtifact={(id: string) => {
                p.setSelectedArtifactId(id);
                // A pane without a docked panel shows the Outputs overlay instead.
                if (canPanel) p.setArtifactPanelOpen(true);
                else setOutputsOverlay(true);
              }}
              onClarificationAnswer={p.handleClarificationAnswer}
              onUiSubmit={isSub || isSide ? undefined : p.handleUiSubmit}
              onApprovePlan={p.mode === "plan" && !p.toolsAvailable ? p.approvePlanReply : undefined}
              toolsAvailable={p.toolsAvailable}
              scrollRef={p.scrollRef}
              statusLabel={p.currentModelName ? `Waiting for ${p.currentModelName}…` : undefined}
              onQuote={p.addQuote}
              onSideChat={canSide ? p.askSide : undefined}
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
            quote={p.quotes[0]}
            onQuoteRemove={p.removeQuote}
          />
        )}
        {!isSub && !isSide && (
          <BridgeNotice conversationId={conversationId} model={p.conversation.model} saveFailed={p.bridgeSaveFailed} saveDropped={p.bridgeSaveDropped} onRetry={() => void p.retryBridgeSave()} />
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
          onQuoteSide={canSide ? p.moveQuoteToSide : undefined}
          dictateQuoteId={p.dictateQuoteId}
          onDictateStarted={() => p.setDictateQuoteId(null)}
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
      {!canPanel && (
        <ArtifactPanel
          conversationId={conversationId}
          isOpen={outputsOverlay}
          onClose={() => setOutputsOverlay(false)}
          selectedId={selectedArtifactId}
          onSelect={(id: string | null) => p.setSelectedArtifactId(id)}
        />
      )}
      {panel.panel && canPanel && (
        <ChatSidePanel
          view={view}
          hasFiles={hasFiles}
          quietOpen={quietOpen}
          onView={(v) => openView(v)}
          onClose={panel.close}
        >
          {panelBody}
        </ChatSidePanel>
      )}
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
    </RunScope.Provider>
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
