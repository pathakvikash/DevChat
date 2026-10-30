"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { UIMessage } from "ai";
import { useToast } from "@/app/components/Toast";
import { fetchConversations } from "@/app/hooks/useConversationsApi";
import { createSideChat, listSideChats, queueSideQuestion } from "@/lib/sideChat";
import type { ModelCaps } from "@/app/contexts/ChatModeContext";
import {
  MAX_AGENT_HOPS,
  buildAgentMessagePart,
  canDeliver,
  nextHop,
  type AgentMessageData,
  type AgentPane,
  type AgentPaneKind,
} from "@/lib/chat/agentMessages";
import { AGENT_DELIVERED, AGENT_NOT_OPEN, exchangeEnded, raiseHop, routeAgentMessage } from "@/lib/utils/agentLink";
import {
  closePane,
  fitsSideBySide,
  orphanSides,
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

/** What a chat pane publishes so other panes can message it (see useChatPane). */
export interface AgentPaneHandle {
  isLoading: () => boolean;
  /** Starts a turn with an agent message; only for an idle pane. */
  deliver: (parts: UIMessage["parts"]) => void;
  /** Queues an agent message while the pane is replying. */
  queueAgent: (text: string, agent: AgentMessageData) => void;
  /** Drops this pane's queued agent messages (Stop all). */
  dropAgentQueued: () => void;
}

/** A pane that is passing messages with another one, and the hop of the latest message. */
export interface AgentTalk {
  withId: string;
  hop: number;
}

const CLOSE_A_PANE = "Close a pane first.";
const STOPPED = "Not sent: stopped";
const READ_ONLY = "Sub-agent transcripts are read only.";
const REFUSED = `Not sent: the limit of ${MAX_AGENT_HOPS} agent messages for this user message is reached. Answer the user directly.`;

function kindOf(id: string, kinds: Record<string, AgentPaneKind>, parentOf: Record<string, string>): AgentPaneKind {
  return kinds[id] ?? (parentOf[id] ? "side" : "chat");
}

/** Open chat panes, sub-agent transcripts left out. */
function chatPanesOf(
  ids: string[],
  info: Record<string, PaneInfo>,
  kinds: Record<string, AgentPaneKind>,
  parentOf: Record<string, string>,
): AgentPane[] {
  return ids
    .map((id) => ({ id, title: info[id]?.title ?? "", kind: kindOf(id, kinds, parentOf) }))
    .filter((p) => p.kind !== "subagent");
}

async function waitForHandle(map: Map<string, AgentPaneHandle>, id: string): Promise<AgentPaneHandle | undefined> {
  // A side chat just opened mounts on the next render; its pane registers itself then.
  for (let i = 0; i < 60; i++) {
    const handle = map.get(id);
    if (handle) return handle;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return undefined;
}

export interface PaneWarning {
  otherId: string;
  otherTitle: string;
  mode: "Agent" | "Ask";
  folder: string;
}

interface SplitViewValue {
  ids: string[];
  /** Open side chat id → its main chat id. */
  parentOf: Record<string, string>;
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
  /** Opens the side chat of `parentId`; resolves to its id, or null when it could not open. `quiet` keeps focus. */
  openSide: (parentId: string, question?: string, quiet?: boolean) => Promise<string | null>;
  toggleSide: (parentId: string) => Promise<void>;
  toggleDock: (sideId: string, parentId: string) => void;
  /** Each pane publishes its model caps, parent and stop, like setPaneBusy. */
  caps: Record<string, ModelCaps>;
  setPaneCaps: (id: string, value: ModelCaps) => void;
  setPaneParent: (id: string, parent: string | null) => void;
  registerStop: (id: string, stop: (() => void) | null) => void;
  /** Agent messaging: open chat panes for the request, each pane's kind, and its message handle. */
  chatPanes: AgentPane[];
  setPaneKind: (id: string, kind: AgentPaneKind) => void;
  setAgentPane: (id: string, handle: AgentPaneHandle | null) => void;
  talk: Record<string, AgentTalk>;
  /** A pane's own user send starts it again from hop 0. */
  resetHop: (id: string) => void;
  /** Raises a pane's hop to at least `hop` (a queued agent message sent from the pane). */
  bumpHop: (id: string, hop: number) => void;
  /** The sendToChat tool: resolves to what the model is told. */
  sendToChat: (fromId: string, to: string, message: string) => Promise<string>;
  /** Tool-less "Send to…": one message at hop 1, nothing goes back. */
  deliverTo: (fromId: string, toId: string, message: string) => string;
  /** Called when a pane's reply ends; the exchange ends once both panes are idle. */
  agentIdle: (id: string) => void;
  /** Stop all: every pane taking part stops and drops its agent messages. */
  stopAgents: () => void;
}

const SplitViewContext = createContext<SplitViewValue | null>(null);

const DOCK_KEY = "vas:sideDock";

/** Side chats open on the side of their main chat remembered last time. */
function readDock(): "left" | "right" {
  try {
    return localStorage.getItem(DOCK_KEY) === "left" ? "left" : "right";
  } catch {
    return "right";
  }
}

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
  const [caps, setCaps] = useState<Record<string, ModelCaps>>({});
  const [parentOf, setParentOf] = useState<Record<string, string>>({});
  const [kinds, setKinds] = useState<Record<string, AgentPaneKind>>({});
  const [talk, setTalk] = useState<Record<string, AgentTalk>>({});
  const stoppers = useRef(new Map<string, () => void>());
  const agentPanes = useRef(new Map<string, AgentPaneHandle>());
  // Hop of each pane's current agent exchange; a pane's own user send clears it.
  const hops = useRef(new Map<string, number>());
  // Who each pane is talking with. A refusal clears `talk` but not this, so the exchange's end still resets both hops.
  const partners = useRef(new Map<string, string>());
  // Counts Stop all: a sendToChat that was waiting on a side pane checks it before it delivers.
  const stopEpoch = useRef(0);
  // Latest committed state, for async steps (after an await) and for the close cascade.
  const live = useRef({ ids, focus, parentOf, info, kinds, talk });
  useEffect(() => {
    live.current = { ids, focus, parentOf, info, kinds, talk };
  });

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
    if (isBusy(focus)) stoppers.current.get(focus)?.();
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
    const { ids: now, focus: cur, parentOf: parents } = live.current;
    if (!now.includes(id)) return;
    if (now.length <= 1) {
      // A lone side chat closes back to its main chat.
      const parent = parents[id];
      if (parent && confirmBusy(id, "Close")) {
        if (isBusy(id)) stoppers.current.get(id)?.();
        router.replace(`/c/${parent}`, { scroll: false });
      }
      return;
    }
    // A main chat takes its side chats with it, unless that would leave nothing open.
    const orphans = orphanSides(now, parents, id);
    const toClose = now.length - 1 - orphans.length > 0 ? [id, ...orphans] : [id];
    const busyOnes = toClose.filter((x) => isBusy(x));
    if (busyOnes.length && !window.confirm(`Close "${titleOf(id)}"? Its reply will stop and unsent text will be lost.`)) return;
    for (const x of busyOnes) stoppers.current.get(x)?.();
    let next = { ids: now, focus: cur };
    for (const x of toClose) next = closePane(next.ids, x, next.focus);
    commit(next);
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

  /** The latest side chat of a main chat; created when it has none. */
  const sideFor = async (parentId: string) => {
    const list = await listSideChats(parentId).catch(() => []);
    return list[0]?.id ?? (await createSideChat(parentId)).id;
  };

  const openSide = async (parentId: string, question?: string, quiet = false): Promise<string | null> => {
    const sideId = await sideFor(parentId);
    const now = live.current.ids; // read after the await: the panes may have changed meanwhile
    if (now.includes(sideId)) {
      commit({ ids: now, focus: quiet ? live.current.focus : sideId });
      return sideId;
    }
    if (!now.includes(parentId)) return null;
    const next = openPane(now, sideId, { index: now.indexOf(parentId), side: readDock() }, limit);
    if (next === "full") {
      toast(`Close a pane first. Up to ${limit} fit at this width.`, "info");
      return null;
    }
    if (question) queueSideQuestion(sideId, question);
    commit({ ids: next, focus: quiet ? live.current.focus : sideId });
    return sideId;
  };

  const toggleSide = async (parentId: string) => {
    const sideId = await sideFor(parentId);
    if (live.current.ids.includes(sideId)) {
      closeChat(sideId);
      return;
    }
    await openSide(parentId);
  };

  /* ─── Agent messaging ──────────────────────────────────────────────────── */

  const chatPanes = useMemo(() => chatPanesOf(ids, info, kinds, parentOf), [ids, info, kinds, parentOf]);

  const setPaneKind = useCallback((id: string, kind: AgentPaneKind) => {
    setKinds((prev) => (prev[id] === kind ? prev : { ...prev, [id]: kind }));
  }, []);

  const setAgentPane = useCallback((id: string, handle: AgentPaneHandle | null) => {
    if (handle) agentPanes.current.set(id, handle);
    else agentPanes.current.delete(id);
  }, []);

  const hopOf = (id: string) => hops.current.get(id) ?? 0;
  const setHop = (id: string, hop: number) => {
    if (hop > 0) hops.current.set(id, hop);
    else hops.current.delete(id);
  };
  const resetHop = useCallback((id: string) => hops.current.delete(id), []);
  const bumpHop = (id: string, hop: number) => setHop(id, raiseHop(hopOf(id), hop));

  const startTalk = (a: string, b: string, hop: number) => {
    partners.current.set(a, b).set(b, a);
    setTalk((prev) => ({ ...prev, [a]: { withId: b, hop }, [b]: { withId: a, hop } }));
  };

  const endTalkOf = (id: string) => {
    const partner = live.current.talk[id]?.withId;
    setTalk((prev) => {
      const next = { ...prev };
      delete next[id];
      if (partner) delete next[partner];
      return next;
    });
  };

  /** Hands a message to an open pane: a new turn when it is idle, its queue while it replies. */
  const dispatch = (fromId: string, toId: string, message: string, hop: number): string => {
    const receiver = agentPanes.current.get(toId);
    if (!receiver) return AGENT_NOT_OPEN;
    const now = live.current;
    const agent: AgentMessageData = {
      from: kindOf(fromId, now.kinds, now.parentOf) === "side" ? "side" : "chat",
      fromConversationId: fromId,
      fromTitle: now.info[fromId]?.title ?? "",
      hop,
    };
    setHop(fromId, raiseHop(hopOf(fromId), hop));
    setHop(toId, raiseHop(hopOf(toId), hop));
    if (receiver.isLoading()) receiver.queueAgent(message, agent);
    else receiver.deliver([buildAgentMessagePart(agent), { type: "text", text: message }]);
    startTalk(fromId, toId, hop);
    return AGENT_DELIVERED;
  };

  const sendToChat = async (fromId: string, to: string, message: string): Promise<string> => {
    const hop = nextHop(hopOf(fromId));
    if (!canDeliver(hop)) {
      endTalkOf(fromId);
      return REFUSED;
    }
    const now = live.current;
    if (kindOf(fromId, now.kinds, now.parentOf) === "subagent") return READ_ONLY;
    const route = routeAgentMessage(to, fromId, chatPanesOf(now.ids, now.info, now.kinds, now.parentOf), now.parentOf);
    if ("error" in route) return route.error;
    const epoch = stopEpoch.current;
    const toId = "id" in route ? route.id : await openSide(route.openSideOf, undefined, true);
    if (!toId) return CLOSE_A_PANE;
    const handle = await waitForHandle(agentPanes.current, toId);
    if (stopEpoch.current !== epoch) return STOPPED;
    if (!handle) return AGENT_NOT_OPEN;
    return dispatch(fromId, toId, message, hop);
  };

  const deliverTo = (fromId: string, toId: string, message: string): string => {
    const now = live.current;
    if (kindOf(fromId, now.kinds, now.parentOf) === "subagent") return READ_ONLY;
    const open = chatPanesOf(now.ids, now.info, now.kinds, now.parentOf).some((p) => p.id === toId);
    if (toId === fromId || !open) return AGENT_NOT_OPEN;
    return dispatch(fromId, toId, message, 1);
  };

  /** A pane's reply ended: if the other pane of its exchange is idle too, the exchange is over and both hops start again. */
  const agentIdle = (id: string) => {
    const ended = exchangeEnded(id, partners.current, (p) => agentPanes.current.get(p)?.isLoading() ?? false);
    if (!ended.length) return;
    for (const x of ended) {
      hops.current.delete(x);
      partners.current.delete(x);
    }
    setTalk((prev) => {
      const next = { ...prev };
      for (const x of ended) delete next[x];
      return next;
    });
  };

  const stopAgents = () => {
    stopEpoch.current += 1;
    const involved = new Set([...Object.keys(live.current.talk), ...hops.current.keys()]);
    for (const id of involved) {
      stoppers.current.get(id)?.();
      agentPanes.current.get(id)?.dropAgentQueued();
    }
    hops.current.clear();
    partners.current.clear();
    setTalk({});
  };

  /** Moves a side chat to the other side of its parent by swapping the two. */
  const toggleDock = (sideId: string, parentId: string) => {
    const now = live.current.ids;
    const i = now.indexOf(parentId);
    const j = now.indexOf(sideId);
    if (i < 0 || j < 0) return;
    const next = [...now];
    [next[i], next[j]] = [next[j], next[i]];
    try {
      localStorage.setItem(DOCK_KEY, next.indexOf(sideId) < next.indexOf(parentId) ? "left" : "right");
    } catch {}
    commit({ ids: next, focus: live.current.focus });
  };

  const setPaneCaps = useCallback((id: string, value: ModelCaps) => {
    setCaps((prev) => (prev[id]?.toolsAvailable === value.toolsAvailable ? prev : { ...prev, [id]: value }));
  }, []);

  const setPaneParent = useCallback((id: string, parent: string | null) => {
    setParentOf((prev) => {
      if (!parent) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return prev[id] === parent ? prev : { ...prev, [id]: parent };
    });
  }, []);

  const registerStop = useCallback((id: string, stop: (() => void) | null) => {
    if (stop) stoppers.current.set(id, stop);
    else stoppers.current.delete(id);
  }, []);

  const value: SplitViewValue = {
    ids,
    parentOf,
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
    openSide,
    toggleSide,
    toggleDock,
    caps,
    setPaneCaps,
    setPaneParent,
    registerStop,
    chatPanes,
    setPaneKind,
    setAgentPane,
    talk,
    resetHop,
    bumpHop,
    sendToChat,
    deliverTo,
    agentIdle,
    stopAgents,
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
