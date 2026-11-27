"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";
import { Search, Trash2, Edit2, Sparkles, Loader2, Pin, Archive, X, MoreHorizontal, CheckSquare, Square, User as UserIcon, Columns2, Workflow, Table2, SquarePen, FileCode, BookOpen, Brain, PanelLeftClose, ListFilter, Check } from "lucide-react";
import { useSession } from "next-auth/react";
import { useSidebar } from "@/app/contexts/SidebarContext";
import { CHAT_DRAG_TYPE, useSplitViewOptional } from "@/app/c/SplitViewContext";
import { buildSidebarTree, type TreeRow } from "@/lib/sidebarTree";
import { useResource } from "@/app/hooks/useResource";
import {
  createConversation,
  fetchConversations,
  updateConversation,
  deleteConversation as apiDeleteConversation,
  generateTitle as apiGenerateTitle,
} from "@/app/hooks/useConversationsApi";
import ProfileDialog from "./ProfileDialog";
import { useToast } from "@/app/components/Toast";
import { OrreryMark } from "./OrreryMark";

interface ConversationItem {
  id: string;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  pinned?: boolean;
  archived?: boolean;
  forkedFromId?: string | null;
  _count: {
    messages: number;
  };
}

const INDENT_PX = 20;
const LINE_X = 12; // how far left of a row its own level's line runs
const LINE = "absolute -top-1 border-[var(--glass-border-strong)]";

/** The tree lines beside a nested row. The wrapper is the row's border box (-inset-px), so each line starts one row gap above it and stays unbroken. */
function TreeLines({ depth, isLastChild, through }: Omit<TreeRow<ConversationItem>, "item">) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute -inset-px">
      {through.map((on, i) =>
        on && (
          <span
            key={i}
            className={`${LINE} bottom-0 border-l`}
            style={{ left: -(LINE_X + INDENT_PX * (depth - 1 - i)) }}
          />
        ),
      )}
      {isLastChild ? (
        <span
          className={`${LINE} h-[calc(50%+0.25rem)] rounded-bl-lg border-b border-l`}
          style={{ left: -LINE_X, width: LINE_X }}
        />
      ) : (
        <span className={`${LINE} bottom-0 border-l`} style={{ left: -LINE_X }} />
      )}
    </span>
  );
}

/** Marks a row that is on screen. It sits over the hover actions' slot, so no row changes size; hovering swaps it for them. */
function OnScreenMark({ label, focused }: { label: string | null; focused: boolean }) {
  if (!label) return null;
  return (
    <span
      role="img"
      aria-label={label}
      className={`pointer-events-none absolute right-3 top-1/2 flex size-[22px] -translate-y-1/2 items-center justify-center transition group-hover:opacity-0 ${
        focused ? "text-zinc-200" : "text-zinc-400"
      }`}
    >
      <Columns2 size={14} />
    </span>
  );
}

export default function Sidebar() {
  const { close, toggleCollapsed } = useSidebar();
  const { data: session } = useSession();
  const [searchInput, setSearchInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [view, setView] = useState<"recent" | "archived">("recent");
  const [selectMode, setSelectMode] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const pathname = usePathname();
  const { toast } = useToast();
  const split = useSplitViewOptional();
  const reduceMotion = useReducedMotion();

  const {
    data: conversationsData,
    loading,
    setData: setConversations,
    refetch,
  } = useResource<ConversationItem[]>(
    fetchConversations,
    [],
    { onError: (e) => console.error("Failed to fetch conversations:", e) },
  );
  const conversations = conversationsData ?? [];
  const firstLoad = loading && conversationsData === null; // refetches keep the rows on screen

  // Rows that are there when the list first loads (or while searching) appear without animation; later ones fade in.
  const [hasLoaded, setHasLoaded] = useState(false);
  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => setHasLoaded(true), 0);
    return () => clearTimeout(t);
  }, [loading]);
  const animateRows = hasLoaded && !reduceMotion && searchInput === "";

  // A chat marked temporary drops out of the list at once; un-marking brings it back.
  useEffect(() => {
    function onTemporaryChanged(e: Event) {
      const { id, temporary } = (e as CustomEvent).detail;
      if (temporary) setConversations((prev) => (prev ?? []).filter((c) => c.id !== id));
      else void refetch();
    }
    window.addEventListener("vas:temporary-changed", onTemporaryChanged);
    return () => window.removeEventListener("vas:temporary-changed", onTemporaryChanged);
  }, [setConversations, refetch]);

  // A fork is made on the page, so the list (which stays mounted) has to fetch it.
  useEffect(() => {
    const onForked = () => void refetch();
    window.addEventListener("vas:chat-forked", onForked);
    return () => window.removeEventListener("vas:chat-forked", onForked);
  }, [refetch]);

  const filteredConversations = conversations.filter((c) => {
    const matchesSearch = c.title.toLowerCase().includes(searchInput.toLowerCase());
    if (!matchesSearch) return false;
    return view === "archived" ? c.archived === true : c.archived !== true;
  });

  // A search shows a flat list; otherwise forks sit under their parent.
  const rows = buildSidebarTree(filteredConversations, { flat: searchInput !== "" });
  // Rows come grouped by their top-level row (pinned roots first), so split at the roots: no chat is dropped or repeated.
  const splitPinned = view === "recent";
  const pinnedRows: typeof rows = [];
  const recentRows: typeof rows = [];
  let inPinned = false;
  for (const row of rows) {
    if (row.depth === 0) inPinned = splitPinned && row.item.pinned === true;
    (inPinned ? pinnedRows : recentRows).push(row);
  }

  async function createNewChat() {
    try {
      const newConv = await createConversation();
      if (split?.multi) {
        split.replaceFocused(newConv.id);
        return;
      }
      // A full page load skips React cleanup, so tell an open temporary chat to delete itself.
      window.dispatchEvent(new Event("vas:leaving-chat"));
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
  // Side chats are not listed, so a focused side pane lights up its main chat's row.
  const focusedId = split?.ids.length ? (split.parentOf[split.focus] ?? split.focus) : null;
  const activeConvId = focusedId ?? currentConvId;

  /** The label of the mark on a row that is on screen, or null. Only listed panes count; side chats are not listed. */
  function onScreenLabel(id: string): string | null {
    if (!split) return null;
    const listed = split.ids.filter((open) => !split.parentOf[open]);
    const pane = listed.indexOf(id);
    if (pane >= 0 && listed.length > 1) return `Open in split view, pane ${pane + 1} of ${listed.length}`;
    return split.ids.some((open) => split.parentOf[open] === id) ? "Side chat open" : null;
  }

  function onChatDragStart(e: React.DragEvent, id: string) {
    e.dataTransfer.setData(CHAT_DRAG_TYPE, id);
    e.dataTransfer.setData("text/uri-list", `/c/${id}`);
    e.dataTransfer.effectAllowed = "move";
    setMenuOpenId(null);
    split?.startDrag(id);
  }

  const isSelecting = selectMode;

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

  function exitSelectMode() {
    setSelectMode(false);
    clearSelection();
  }

  function closeSearch() {
    setSearchInput("");
    setSearchOpen(false);
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
      exitSelectMode();
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

  const navLinks = [
    { href: "/workflows", label: "Workflows", Icon: Workflow },
    { href: "/tables", label: "Tables", Icon: Table2 },
    { href: "/artifacts", label: "Artifacts", Icon: FileCode },
    { href: "/kb", label: "Knowledge", Icon: BookOpen },
    { href: "/memory", label: "Memory", Icon: Brain },
  ];

  const menuItem = "flex w-full items-center gap-2 px-3 py-2 text-xs text-[var(--foreground)] hover:bg-[var(--row-hover)] transition";

  const filterButton = (
    <div className="relative">
      <button
        onClick={() => setFilterMenuOpen((v) => !v)}
        className="flex size-6 items-center justify-center rounded text-zinc-500 hover:bg-[var(--row-hover)] hover:text-[var(--foreground)]"
        title="Filter chats"
        aria-label="Filter chats"
        aria-haspopup="menu"
        aria-expanded={filterMenuOpen}
      >
        <ListFilter size={14} />
      </button>
      {filterMenuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setFilterMenuOpen(false)} />
          <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-[var(--glass-radius-md)] border border-[var(--glass-border)] bg-[var(--background)] shadow-lg">
            <button role="menuitemradio" aria-checked={view === "recent"} onClick={() => { setView("recent"); setFilterMenuOpen(false); }} className={menuItem}>
              <Check size={12} className={view === "recent" ? "" : "invisible"} />
              Recent
            </button>
            <button role="menuitemradio" aria-checked={view === "archived"} onClick={() => { setView("archived"); setFilterMenuOpen(false); }} className={menuItem}>
              <Check size={12} className={view === "archived" ? "" : "invisible"} />
              Archived
            </button>
            <button
              role="menuitem"
              onClick={() => { if (selectMode) exitSelectMode(); else setSelectMode(true); setFilterMenuOpen(false); }}
              className={menuItem}
            >
              <CheckSquare size={12} />
              {selectMode ? "Done selecting" : "Select chats"}
            </button>
          </div>
        </>
      )}
    </div>
  );

  function renderRow({ item: conv, depth, isLastChild, through }: TreeRow<ConversationItem>) {
    return (
      <div
        data-depth={depth}
        data-active={activeConvId === conv.id}
        style={depth ? { marginLeft: depth * INDENT_PX } : undefined}
        draggable={editingId !== conv.id}
        onDragStart={(e) => onChatDragStart(e, conv.id)}
        onDragEnd={() => split?.endDrag()}
        onContextMenu={(e) => { e.preventDefault(); setMenuOpenId(conv.id); }}
        className={`group relative flex h-10 md:h-9 items-center gap-2 rounded-lg border border-transparent px-2.5 transition hover:bg-[var(--row-hover)] data-[active=true]:bg-[var(--row-active)] ${
          menuOpenId === conv.id ? "z-30" : "" /* its menu paints over the rows below */
        } ${activeConvId === conv.id ? "text-[var(--foreground)]" : "text-zinc-400"}`}
      >
        {depth > 0 && <TreeLines depth={depth} isLastChild={isLastChild} through={through} />}
        {isSelecting && (
          <button
            onClick={() => toggleSelect(conv.id)}
            className={`shrink-0 p-0.5 rounded transition ${selectedIds.has(conv.id) ? "text-blue-400" : "text-zinc-500"}`}
            title={selectedIds.has(conv.id) ? "Deselect" : "Select"}
          >
            {selectedIds.has(conv.id) ? <CheckSquare size={14} /> : <Square size={14} />}
          </button>
        )}
        <Link
          href={`/c/${conv.id}`}
          onClick={(e) => {
            close();
            // With panes open, a plain click opens the chat in the focused pane.
            if (split?.multi && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
              e.preventDefault();
              split.replaceFocused(conv.id);
            }
          }}
          draggable={false}
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
                if (e.key === "Enter") { e.preventDefault(); updateTitle(conv.id, editingTitle); }
                if (e.key === "Escape") { e.preventDefault(); setEditingId(null); }
              }}
              className="w-full glass-input rounded px-2 py-1"
              onClick={(e) => e.preventDefault()}
            />
          ) : (
            <div className="truncate text-sm">{conv.title}</div>
          )}
        </Link>
        <OnScreenMark label={onScreenLabel(conv.id)} focused={focusedId === conv.id} />
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
                  {split?.sideBySide && (
                    <button
                      onClick={() => { split.openSplit(conv.id); setMenuOpenId(null); }}
                      aria-disabled={split.ids.length >= split.limit && !split.ids.includes(conv.id)}
                      title={split.ids.length >= split.limit && !split.ids.includes(conv.id) ? `Close a pane first. Up to ${split.limit} fit at this width.` : undefined}
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs text-[var(--foreground)] hover:bg-[var(--row-hover)] transition aria-disabled:opacity-50"
                    >
                      <Columns2 size={12} />
                      Open in split view
                    </button>
                  )}
                  {editingId !== conv.id && (
                    <>
                      <button
                        onClick={() => { generateTitle(conv.id); setMenuOpenId(null); }}
                        disabled={generatingId === conv.id}
                        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-[var(--foreground)] hover:bg-[var(--row-hover)] transition disabled:opacity-50"
                      >
                        {generatingId === conv.id ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                        Generate title
                      </button>
                      <button
                        onClick={() => { setEditingId(conv.id); setEditingTitle(conv.title); setMenuOpenId(null); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-[var(--foreground)] hover:bg-[var(--row-hover)] transition"
                      >
                        <Edit2 size={12} />
                        Rename
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => { toggleArchive(conv); setMenuOpenId(null); }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--row-hover)] transition ${
                      conv.archived ? "text-blue-500" : "text-[var(--foreground)]"
                    }`}
                  >
                    <Archive size={12} />
                    {conv.archived ? "Unarchive" : "Archive"}
                  </button>
                  <button
                    onClick={() => { deleteConversation(conv.id); setMenuOpenId(null); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-xs text-red-500 hover:bg-[var(--row-hover)] transition"
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
    );
  }

  /** One list row. The motion wrapper is separate from the row: motion props swallow native onDragStart/onDragEnd. */
  function renderAnimatedRow(row: TreeRow<ConversationItem>, first: boolean) {
    const gap = first ? 0 : 2; // the 0.5 spacing between rows
    return (
      <motion.div
        key={row.item.id}
        layout={reduceMotion ? false : "position"}
        initial={animateRows ? { opacity: 0, y: -8 } : false}
        animate={{ opacity: 1, y: 0, height: "auto", marginTop: gap }}
        exit={animateRows ? { opacity: 0, height: 0, marginTop: 0, overflow: "hidden" } : undefined}
        transition={{ duration: 0.16, ease: "easeOut" }}
      >
        {renderRow(row)}
      </motion.div>
    );
  }

  return (
    <div className="flex h-screen w-64 flex-col border-r border-[var(--glass-border)] bg-[var(--background)]">
      {/* Top row */}
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <Link href="/" onClick={close} className="flex items-center gap-2 px-1 py-1">
          <OrreryMark decorative />
          <span className="text-sm font-semibold text-[var(--foreground)]">Orrery</span>
        </Link>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleCollapsed}
            className="hidden md:flex size-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-[var(--row-hover)] hover:text-[var(--foreground)]"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose size={16} />
          </button>
          <button
            onClick={close}
            className="md:hidden size-8 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-[var(--row-hover)]"
            title="Close sidebar"
            aria-label="Close sidebar"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Nav */}
      <nav aria-label="Primary" className="flex flex-col gap-0.5 px-2 pt-1 text-zinc-300">
        <button onClick={createNewChat} className="nav-row">
          <SquarePen size={16} />
          New chat
        </button>
        {searchOpen ? (
          <motion.div
            className="nav-row"
            initial={reduceMotion ? false : { opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            <Search size={16} className="shrink-0" />
            <input
              type="text"
              autoFocus
              aria-label="Search conversations"
              placeholder="Search conversations..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); closeSearch(); } }}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-500"
            />
          </motion.div>
        ) : (
          <button onClick={() => setSearchOpen(true)} className="nav-row">
            <Search size={16} />
            Search
          </button>
        )}
        {navLinks.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={close}
            aria-current={pathname?.startsWith(href) ? "page" : undefined}
            className="nav-row focus-ring"
          >
            <Icon size={16} />
            {label}
          </Link>
        ))}
      </nav>

      {/* Bulk action bar */}
      {isSelecting && (
        <div className="mt-2 flex items-center gap-2 border-y border-[var(--glass-border)] px-3 py-1.5">
          <span className="mr-auto text-xs text-[var(--foreground)]/60">{selectedIds.size} selected</span>
          <button onClick={selectAll} className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-[var(--row-hover)]">All</button>
          <button onClick={bulkArchive} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-[var(--foreground)] hover:bg-[var(--row-hover)]">
            <Archive size={12} />
            Archive
          </button>
          <button onClick={bulkDelete} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-red-500 hover:bg-[var(--row-hover)]">
            <Trash2 size={12} />
            Delete
          </button>
          <button onClick={exitSelectMode} className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-[var(--row-hover)]">Done</button>
        </div>
      )}

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <AnimatePresence initial={false}>
          {pinnedRows.length > 0 && (
            <motion.div
              key="pinned-header"
              className="nav-section"
              initial={animateRows ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              exit={animateRows ? { opacity: 0 } : undefined}
              transition={{ duration: 0.15 }}
            >
              Pinned
            </motion.div>
          )}
          {pinnedRows.map((row, i) => renderAnimatedRow(row, i === 0))}
          <div key="recent-header" className="nav-section flex items-center justify-between">
            <span>{view === "archived" ? "Archived" : "Recent"}</span>
            {filterButton}
          </div>
          {!firstLoad && recentRows.map((row, i) => renderAnimatedRow(row, i === 0))}
        </AnimatePresence>
        {firstLoad ? (
          <div className="p-2 text-zinc-400 text-sm">Loading...</div>
        ) : filteredConversations.length === 0 ? (
          <div className="p-2 text-zinc-400 text-sm">No conversations yet</div>
        ) : null}
      </div>

      {/* Footer: user */}
      <div className="border-t border-[var(--glass-border)] p-2">
        {session?.user && (
          <button onClick={() => setProfileOpen(true)} className="nav-row" aria-label="Open profile">
            {session.user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={session.user.image} alt="" className="size-6 rounded-full shrink-0" />
            ) : (
              <div className="size-6 rounded-full bg-[var(--row-active)] flex items-center justify-center shrink-0">
                <UserIcon size={13} className="text-zinc-400" />
              </div>
            )}
            <span className="flex-1 min-w-0 truncate text-sm text-zinc-200">
              {session.user.name || session.user.email}
            </span>
            <MoreHorizontal size={16} className="shrink-0 text-zinc-500" />
          </button>
        )}
        <ProfileDialog isOpen={profileOpen} onClose={() => setProfileOpen(false)} />
      </div>
    </div>
  );
}
