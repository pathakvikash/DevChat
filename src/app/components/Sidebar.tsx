"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus, Search, Trash2, Edit2, Settings, BookOpen, Brain, Sparkles, Loader2, Cpu, Pin, Archive, X, StickyNote, HardDrive, MoreHorizontal, CheckSquare, Square, CheckCheck, Activity } from "lucide-react";
import { useSidebar } from "@/app/contexts/SidebarContext";
import { useResource } from "@/app/hooks/useResource";
import {
  createConversation,
  fetchConversations,
  updateConversation,
  deleteConversation as apiDeleteConversation,
  generateTitle as apiGenerateTitle,
} from "@/app/hooks/useConversationsApi";
import OllamaModelManagerDialog from "./OllamaModelManagerDialog";
import { useToast } from "@/app/components/Toast";

interface ConversationItem {
  id: string;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  pinned?: boolean;
  archived?: boolean;
  _count: {
    messages: number;
  };
}

export default function Sidebar() {
  const { close } = useSidebar();
  const [searchInput, setSearchInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [showModelManager, setShowModelManager] = useState(false);
  const [activeFilter, setActiveFilter] = useState<"all" | "pinned" | "archived">("all");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const pathname = usePathname();
  const { toast } = useToast();

  const {
    data: conversationsData,
    loading,
    setData: setConversations,
  } = useResource<ConversationItem[]>(
    fetchConversations,
    [],
    { onError: (e) => console.error("Failed to fetch conversations:", e) },
  );
  const conversations = conversationsData ?? [];

  const filteredConversations = conversations.filter((c) => {
    const matchesSearch = c.title.toLowerCase().includes(searchInput.toLowerCase());
    if (!matchesSearch) return false;
    if (activeFilter === "pinned") return c.pinned === true;
    if (activeFilter === "archived") return c.archived === true;
    return c.archived !== true;
  });

  async function createNewChat() {
    try {
      const newConv = await createConversation();
      window.location.href = `/c/${newConv.id}`;
    } catch (error) {
      console.error("Failed to create conversation:", error);
    }
  }

  async function deleteConversation(id: string) {
    if (!confirm("Delete this conversation?")) return;
    try {
      await apiDeleteConversation(id);
      setConversations((prev) => (prev ?? []).filter((c) => c.id !== id));
    } catch (error) {
      console.error("Failed to delete conversation:", error);
      toast("Failed to delete conversation", "error");
    }
  }

  async function togglePin(conv: ConversationItem) {
    const newPinned = !conv.pinned;
    try {
      await updateConversation(conv.id, { pinned: newPinned });
      setConversations((prev) =>
        (prev ?? []).map((c) =>
          c.id === conv.id ? { ...c, pinned: newPinned } : c
        )
      );
    } catch (error) {
      console.error("Failed to toggle pin:", error);
      toast("Failed to update conversation", "error");
    }
  }

  async function toggleArchive(conv: ConversationItem) {
    const newArchived = !conv.archived;
    try {
      await updateConversation(conv.id, { archived: newArchived });
      setConversations((prev) =>
        (prev ?? []).map((c) =>
          c.id === conv.id ? { ...c, archived: newArchived } : c
        )
      );
    } catch (error) {
      console.error("Failed to toggle archive:", error);
      toast("Failed to update conversation", "error");
    }
  }

  async function updateTitle(id: string, newTitle: string) {
    try {
      await updateConversation(id, { title: newTitle });
      setConversations((prev) =>
        (prev ?? []).map((c) => (c.id === id ? { ...c, title: newTitle } : c))
      );
      setEditingId(null);
    } catch (error) {
      console.error("Failed to update conversation:", error);
    }
  }

  async function generateTitle(id: string) {
    setGeneratingId(id);
    try {
      const data = await apiGenerateTitle(id);
      if (data.title) {
        setConversations((prev) =>
          (prev ?? []).map((c) => (c.id === id ? { ...c, title: data.title! } : c))
        );
        window.dispatchEvent(new CustomEvent("vas:title-updated", { detail: { id, title: data.title } }));
      }
    } catch (error) {
      console.error("Failed to generate title:", error);
      toast("Failed to generate title", "error");
    } finally {
      setGeneratingId(null);
    }
  }

  const currentConvId = pathname.startsWith("/c/") ? pathname.split("/")[2] : null;

  const isSelecting = selectedIds.size > 0;

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(filteredConversations.map((c) => c.id)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function runBulkAction(
    ids: string[],
    action: (id: string) => Promise<unknown>,
    applySuccess: () => void,
    successMsg: string,
    failureMsg: string,
  ) {
    try {
      await Promise.all(ids.map(action));
      applySuccess();
      clearSelection();
      toast(successMsg, "success");
    } catch {
      toast(failureMsg, "error");
    }
  }

  async function bulkArchive() {
    const ids = [...selectedIds];
    if (!ids.length) return;
    const msg = `Archive ${ids.length} conversation${ids.length > 1 ? "s" : ""}?`;
    if (!confirm(msg)) return;
    await runBulkAction(
      ids,
      (id) => updateConversation(id, { archived: true }),
      () =>
        setConversations((prev) =>
          (prev ?? []).map((c) => (ids.includes(c.id) ? { ...c, archived: true } : c))
        ),
      `Archived ${ids.length} conversation${ids.length > 1 ? "s" : ""}`,
      "Failed to archive some conversations",
    );
  }

  async function bulkDelete() {
    const ids = [...selectedIds];
    if (!ids.length) return;
    const msg = `Permanently delete ${ids.length} conversation${ids.length > 1 ? "s" : ""}? This cannot be undone.`;
    if (!confirm(msg)) return;
    await runBulkAction(
      ids,
      (id) => apiDeleteConversation(id),
      () => {
        setConversations((prev) => (prev ?? []).filter((c) => !ids.includes(c.id)));
        if (ids.includes(currentConvId ?? "")) {
          window.location.href = "/";
        }
      },
      `Deleted ${ids.length} conversation${ids.length > 1 ? "s" : ""}`,
      "Failed to delete some conversations",
    );
  }

  return (
    <div className="flex flex-col w-64 glass-panel-strong border-r border-[var(--glass-border)] h-screen">
      {/* Header */}
      <div className="p-4 border-b border-[var(--glass-border)] glass-surface">
        <div className="flex items-center gap-2 mb-2 md:hidden">
          <button onClick={close} className="p-1 glass-button rounded transition" title="Close sidebar">
            <X size={18} />
          </button>
        </div>
        <Link href="/" onClick={close} className="flex items-center gap-2 mb-3 group">
          <div className="size-7 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold group-hover:shadow-lg group-hover:shadow-blue-500/30 transition-shadow">
            V
          </div>
          <span className="text-sm font-bold text-[var(--foreground)]">DevChat</span>
        </Link>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={createNewChat}
          className="w-full flex items-center justify-center gap-2 glass-button-primary text-white rounded-[var(--glass-radius-md)] py-2 px-4"
        >
          <Plus size={18} />
          New Chat
        </motion.button>
      </div>

      {/* Search */}
      <div className="p-3 border-b border-[var(--glass-border)]">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-3 text-zinc-400" />
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 pl-9 text-sm"
          />
        </div>
      </div>

      {/* Filter tabs + Select */}
      <div className="flex items-center gap-1 px-3 pt-2 pb-1">
        {(["all", "pinned", "archived"] as const).map((f) => (
          <button
            key={f}
            onClick={() => { setActiveFilter(f); clearSelection(); }}
            className={`px-2.5 py-1 text-xs rounded-full transition ${
              activeFilter === f
                ? "glass-strong text-[var(--foreground)]"
                : "text-zinc-400 hover:text-[var(--foreground)] glass-button"
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <div className="ml-auto">
          <button
            onClick={() => { if (isSelecting) clearSelection(); else selectAll(); }}
            className={`p-1 rounded text-xs transition ${
              isSelecting ? "text-blue-400" : "text-zinc-500 hover:text-[var(--foreground)]"
            }`}
            title={isSelecting ? "Clear selection" : "Select conversations"}
          >
            {isSelecting ? <CheckCheck size={14} /> : <CheckSquare size={14} />}
          </button>
        </div>
      </div>

      {/* Bulk action bar */}
      {isSelecting && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--glass-border)] bg-[var(--glass-bg-elevated)]">
          <span className="text-xs text-[var(--foreground)]/60 mr-auto">{selectedIds.size} selected</span>
          <button onClick={bulkArchive} className="flex items-center gap-1 px-2 py-1 rounded text-xs glass-button text-[var(--foreground)] transition">
            <Archive size={12} />
            Archive
          </button>
          <button onClick={bulkDelete} className="flex items-center gap-1 px-2 py-1 rounded text-xs glass-button text-red-500 hover:text-red-400 transition">
            <Trash2 size={12} />
            Delete
          </button>
        </div>
      )}

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-zinc-400 text-sm">Loading...</div>
        ) : filteredConversations.length === 0 ? (
          <div className="p-4 text-zinc-400 text-sm">No conversations yet</div>
        ) : (
          <div className="space-y-1 p-2">
            {filteredConversations.map((conv) => (
              <div
                key={conv.id}
                className={`group flex items-center gap-2 px-3 py-2 rounded-[var(--glass-radius-sm)] transition ${
                  currentConvId === conv.id
                    ? "glass-strong text-[var(--foreground)]"
                    : "text-zinc-300 glass-button"
                }`}
              >
                <button
                  onClick={() => toggleSelect(conv.id)}
                  className={`shrink-0 p-0.5 rounded transition ${
                    selectedIds.has(conv.id)
                      ? "opacity-100 text-blue-400"
                      : "opacity-0 group-hover:opacity-100 text-zinc-500"
                  }`}
                  title={selectedIds.has(conv.id) ? "Deselect" : "Select"}
                >
                  {selectedIds.has(conv.id) ? <CheckSquare size={14} /> : <Square size={14} />}
                </button>
                <Link
                  href={`/c/${conv.id}`}
                  onClick={close}
                  className="flex-1 min-w-0"
                  title={conv.model.split('/').pop()}
                >
                  {editingId === conv.id ? (
                    <input
                      type="text"
                      autoFocus
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onBlur={() => updateTitle(conv.id, editingTitle)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") updateTitle(conv.id, editingTitle);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="w-full glass-input rounded px-2 py-1"
                      onClick={(e) => e.preventDefault()}
                    />
                  ) : (
                    <div className="truncate">
                      <div className="truncate text-sm">{conv.title}</div>
                      <div className="text-[10px] text-zinc-500 truncate">{conv.model.split('/').pop()}</div>
                    </div>
                  )}
                </Link>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition items-center">
                  {editingId !== conv.id && (
                    <button
                      onClick={(e) => { e.preventDefault(); togglePin(conv); }}
                      className={`p-1 rounded ${
                        conv.pinned
                          ? "text-amber-400"
                          : "text-zinc-500 hover:text-amber-400"
                      }`}
                      title={conv.pinned ? "Unpin" : "Pin"}
                    >
                      <Pin size={14} fill={conv.pinned ? "currentColor" : "none"} />
                    </button>
                  )}
                  <div className="relative">
                    <button
                      onClick={(e) => { e.preventDefault(); setMenuOpenId(menuOpenId === conv.id ? null : conv.id); }}
                      className="p-1 rounded text-zinc-500 hover:text-[var(--foreground)]"
                      title="More actions"
                    >
                      <MoreHorizontal size={14} />
                    </button>
                    {menuOpenId === conv.id && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setMenuOpenId(null)} />
                        <div className="absolute right-0 top-full mt-1 z-20 w-40 glass-panel-strong rounded-[var(--glass-radius-md)] shadow-lg border border-[var(--glass-border)] overflow-hidden">
                          {editingId !== conv.id && (
                            <>
                              <button
                                onClick={() => { generateTitle(conv.id); setMenuOpenId(null); }}
                                disabled={generatingId === conv.id}
                                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-[var(--foreground)] hover:bg-[var(--glass-bg-hover)] transition disabled:opacity-50"
                              >
                                {generatingId === conv.id ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                                Generate title
                              </button>
                              <button
                                onClick={() => { setEditingId(conv.id); setEditingTitle(conv.title); setMenuOpenId(null); }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-[var(--foreground)] hover:bg-[var(--glass-bg-hover)] transition"
                              >
                                <Edit2 size={12} />
                                Rename
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => { toggleArchive(conv); setMenuOpenId(null); }}
                            className={`flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--glass-bg-hover)] transition ${
                              conv.archived ? "text-blue-500" : "text-[var(--foreground)]"
                            }`}
                          >
                            <Archive size={12} />
                            {conv.archived ? "Unarchive" : "Archive"}
                          </button>
                          <button
                            onClick={() => { deleteConversation(conv.id); setMenuOpenId(null); }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-xs text-red-500 hover:bg-[var(--glass-bg-hover)] transition"
                          >
                            <Trash2 size={12} />
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer - Navigation */}
      <div className="p-3 border-t border-[var(--glass-border)] glass-surface">
        <div className="mb-2 text-xs text-zinc-400">
          Total: <strong>{conversations.length}</strong> conversations
        </div>
        <OllamaModelManagerDialog
          isOpen={showModelManager}
          onClose={() => setShowModelManager(false)}
        />
        <div className="grid grid-cols-4 gap-1 mb-2">
          <Link
            href="/kb"
            onClick={close}
            className={`flex items-center justify-center p-2 rounded-[var(--glass-radius-sm)] transition ${
              pathname === "/kb"
                ? "glass-button-primary text-white"
                : "glass-button text-zinc-300"
            }`}
            title="Knowledge Base"
          >
            <BookOpen size={16} />
          </Link>
          <Link
            href="/notes"
            onClick={close}
            className={`flex items-center justify-center p-2 rounded-[var(--glass-radius-sm)] transition ${
              pathname === "/notes"
                ? "glass-button-primary text-white"
                : "glass-button text-zinc-300"
            }`}
            title="Notes"
          >
            <StickyNote size={16} />
          </Link>
          <Link
            href="/memory"
            onClick={close}
            className={`flex items-center justify-center p-2 rounded-[var(--glass-radius-sm)] transition ${
              pathname === "/memory"
                ? "glass-button-primary text-white"
                : "glass-button text-zinc-300"
            }`}
            title="Memory"
          >
            <Brain size={16} />
          </Link>
          <Link
            href="/claude"
            onClick={close}
            className={`flex items-center justify-center p-2 rounded-[var(--glass-radius-sm)] transition ${
              pathname.startsWith("/claude")
                ? "glass-button-primary text-white"
                : "glass-button text-zinc-300"
            }`}
            title="Claude System"
          >
            <HardDrive size={16} />
          </Link>
          <button
            onClick={() => setShowModelManager(true)}
            className="flex items-center justify-center p-2 rounded-[var(--glass-radius-sm)] glass-button text-zinc-300 hover:text-zinc-100 transition"
            title="Manage Models"
          >
            <Cpu size={16} />
          </button>
          <Link
            href="/settings"
            onClick={close}
            className={`flex items-center justify-center p-2 rounded-[var(--glass-radius-sm)] transition ${
              pathname === "/settings"
                ? "glass-button-primary text-white"
                : "glass-button text-zinc-300"
            }`}
            title="Settings"
          >
            <Settings size={16} />
          </Link>
          <Link
            href="/observability"
            onClick={close}
            className={`flex items-center justify-center p-2 rounded-[var(--glass-radius-sm)] transition ${
              pathname === "/observability"
                ? "glass-button-primary text-white"
                : "glass-button text-zinc-300"
            }`}
            title="Observability"
          >
            <Activity size={16} />
          </Link>
        </div>
      </div>
    </div>
  );
}
