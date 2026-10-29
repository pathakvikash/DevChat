"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/app/components/Toast";
import { fetchConversations } from "@/app/hooks/useConversationsApi";
import {
  closePane,
  fitsSideBySide,
  dividersPx,
  maxPanesForWidth,
  nextPane,
  openPane,
  parsePanes,
  replacePane,
  serializePanes,
  writerConflicts,
} from "@/lib/splitPanes";

export const CHAT_DRAG_TYPE = "application/x-devchat-chat";

export interface PaneInfo {
  title: string;
  workingFolder: string | null;
}

export interface PaneWarning {
  otherId: string;
  otherTitle: string;
  mode: "Agent" | "Ask";
  folder: string;
}

interface SplitViewValue {
  ids: string[];
  focus: string;
  multi: boolean;
  limit: number;
  sideBySide: boolean;
  rowWidth: number;
  setRowWidth: (px: number) => void;
  info: Record<string, PaneInfo>;
  warnings: Record<string, PaneWarning>;
  dragId: string | null;
  startDrag: (id: string) => void;
  endDrag: () => void;
  isBusy: (id: string) => boolean;
  setPaneBusy: (id: string, busy: boolean) => void;
  focusPane: (id: string) => void;
  openSplit: (id: string) => void;
  replaceFocused: (id: string) => void;
  insertAt: (id: string, index: number, side: "left" | "right") => void;
  replaceAt: (oldId: string, id: string) => void;
  closeChat: (id: string) => void;
  cycleFocus: (dir: 1 | -1) => void;
}

const SplitViewContext = createContext<SplitViewValue | null>(null);

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

/** Owns the open panes, their focus and their URL. Panes are derived from the URL on every render. */
export function SplitViewProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const { ids, focus } = useMemo(() => parsePanes(pathname, searchParams), [pathname, searchParams]);
  const idsKey = ids.join(",");

  const [windowWidth, setWindowWidth] = useState(0);
  const [rowWidth, setRowWidth] = useState(0);
  const [info, setInfo] = useState<Record<string, PaneInfo>>({});
  const [modes, setModes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [dragId, setDragId] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setWindowWidth(window.innerWidth);
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  const loadInfo = useCallback(async () => {
    try {
      const list = await fetchConversations();
      const next: Record<string, PaneInfo> = {};
      for (const c of list) next[c.id] = { title: c.title, workingFolder: c.workingFolder ?? null };
      setInfo(next);
    } catch {
      // Titles are cosmetic; the panes still work without them.
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads titles for the open panes
    if (idsKey) void loadInfo();
  }, [idsKey, loadInfo]);

  useEffect(() => {
    window.addEventListener("vas:title-updated", loadInfo);
    return () => window.removeEventListener("vas:title-updated", loadInfo);
  }, [loadInfo]);

  // Each pane's mode lives in the same per-chat storage ChatModeContext writes; there is no event, so poll while split.
  useEffect(() => {
    if (ids.length < 2) return;
    const read = () => {
      const next: Record<string, string> = {};
      for (const id of ids) {
        try {
          next[id] = localStorage.getItem(`vas:mode:${id}`) ?? "chat";
        } catch {
          next[id] = "chat";
        }
      }
      setModes((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    read();
    const timer = setInterval(read, 1000);
    return () => clearInterval(timer);
  }, [ids]);

  const limit = windowWidth ? maxPanesForWidth(windowWidth) : 3;
  const sideBySide = rowWidth === 0 || fitsSideBySide(ids.length, rowWidth - dividersPx(ids.length));

  const warnings = useMemo(() => {
    const writers = writerConflicts(
      ids.map((id) => ({ id, kind: "chat", mode: modes[id] ?? "chat", workingFolder: info[id]?.workingFolder ?? null })),
    );
    const out: Record<string, PaneWarning> = {};
    for (const id of writers) {
      const folder = info[id]?.workingFolder ?? "";
      const other = ids.find((o) => o !== id && writers.has(o) && info[o]?.workingFolder === folder);
      if (!other) continue;
      out[id] = {
        otherId: other,
        otherTitle: info[other]?.title ?? "Chat",
        mode: modes[other] === "ask" ? "Ask" : "Agent",
        folder: basename(folder),
      };
    }
    return out;
  }, [ids, modes, info]);

  const isBusy = useCallback((id: string) => !!busy[id], [busy]);
  const setPaneBusy = useCallback((id: string, value: boolean) => {
    setBusy((prev) => (!!prev[id] === value ? prev : { ...prev, [id]: value }));
  }, []);
  const titleOf = (id: string) => info[id]?.title ?? "Chat";

  /** Writes the new panes to the URL. Adding or removing a pane replaces the entry; focus only uses replaceState. */
  const commit = useCallback(
    (next: { ids: string[]; focus: string }) => {
      const keep = new URLSearchParams(searchParams.toString());
      if (next.ids[0] !== ids[0]) keep.delete("q"); // ?q= applies to the first pane only
      const href = serializePanes(next.ids, next.focus, keep);
      if (href === window.location.pathname + window.location.search) return;
      if (next.ids.join(",") !== idsKey) router.replace(href, { scroll: false });
      else window.history.replaceState(null, "", href);
    },
    [ids, idsKey, router, searchParams],
  );

  const focusPane = useCallback(
    (id: string) => {
      if (ids.includes(id) && id !== focus) commit({ ids, focus: id });
    },
    [ids, focus, commit],
  );

  const confirmBusy = (id: string, verb: string) =>
    !isBusy(id) || window.confirm(`${verb} "${titleOf(id)}"? Its reply will stop and unsent text will be lost.`);

  const openSplit = (id: string) => {
    if (ids.includes(id)) return focusPane(id);
    const next = openPane(ids, id, { index: Math.max(0, ids.indexOf(focus)), side: "right" }, limit);
    if (next === "full") return toast(`Close a pane first. Up to ${limit} fit at this width.`, "info");
    commit({ ids: next, focus: id });
  };

  const replaceFocused = (id: string) => {
    if (ids.includes(id)) return focusPane(id);
    if (ids.length && !confirmBusy(focus, "Replace")) return;
    commit(ids.length ? replacePane(ids, focus, id) : { ids: [id], focus: id });
  };

  const insertAt = (id: string, index: number, side: "left" | "right") => {
    const next = openPane(ids, id, { index, side }, limit);
    if (next === "full") return toast(`Close a pane first. Up to ${limit} fit at this width.`, "info");
    commit({ ids: next, focus: id });
  };

  const replaceAt = (oldId: string, id: string) => {
    if (ids.includes(id)) return focusPane(id);
    commit(replacePane(ids, oldId, id));
  };

  const closeChat = (id: string) => {
    if (ids.length <= 1 || !ids.includes(id) || !confirmBusy(id, "Close")) return;
    commit(closePane(ids, id, focus));
  };

  const cycleFocus = (dir: 1 | -1) => {
    const id = nextPane(ids, focus, dir);
    if (!id) return;
    focusPane(id);
    document.querySelector<HTMLTextAreaElement>(`[data-pane-id="${id}"] textarea`)?.focus();
  };

  // Ctrl+` / Ctrl+Shift+` move focus between panes. Kept on a ref so the listener is subscribed once.
  const latest = useRef({ ids, cycleFocus });
  useEffect(() => {
    latest.current = { ids, cycleFocus };
  });
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== "Backquote" || !e.ctrlKey || e.metaKey || e.altKey) return;
      if (latest.current.ids.length < 2) return;
      e.preventDefault();
      latest.current.cycleFocus(e.shiftKey ? -1 : 1);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const value: SplitViewValue = {
    ids,
    focus,
    multi: ids.length > 1,
    limit,
    sideBySide,
    rowWidth,
    setRowWidth,
    info,
    warnings,
    dragId,
    startDrag: setDragId,
    endDrag: () => setDragId(null),
    isBusy,
    setPaneBusy,
    focusPane,
    openSplit,
    replaceFocused,
    insertAt,
    replaceAt,
    closeChat,
    cycleFocus,
  };
  return <SplitViewContext.Provider value={value}>{children}</SplitViewContext.Provider>;
}

export function useSplitView(): SplitViewValue {
  const ctx = useContext(SplitViewContext);
  if (!ctx) throw new Error("useSplitView must be used within SplitViewProvider");
  return ctx;
}

/** Null outside the provider, so the sidebar also works where there is no pane container. */
export function useSplitViewOptional(): SplitViewValue | null {
  return useContext(SplitViewContext);
}
