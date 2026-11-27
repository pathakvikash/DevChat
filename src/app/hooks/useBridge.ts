"use client";

import { useEffect, useSyncExternalStore } from "react";
import { BRIDGE_ORIGIN } from "@/lib/bridge/constants";
import { bridgeStatus, type BridgeStatus, type ProbeOutcome } from "@/lib/bridge/client";
import type { Folder } from "@/app/hooks/useFolders";

export type BridgeModel = { id: string; name: string; provider: string; contextWindow: number; supportsTools?: boolean; supportsVision?: boolean; supportsThinking?: boolean };
type State = {
  token: string | null;
  status: BridgeStatus;
  protocol: number | null;
  version: string | null;
  models: BridgeModel[];
  folders: Folder[];
  checking: boolean;
  /** 0 until the first probe has finished: probes are lazy, never on page load. */
  checkedAt: number;
};

const TOKEN_KEY = "orrery:bridge-token";
const MODELS_KEY = "orrery:bridge-models";

export function readBridgeToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

/** `fetch` to the bridge. The token goes only in the Authorization header, never in a URL or a log line. */
export function bridgeFetch(path: string, init: RequestInit = {}, token = readBridgeToken()): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  // targetAddressSpace is not in the DOM typings yet: it is Chrome's opt-in for a public page to reach loopback.
  return fetch(`${BRIDGE_ORIGIN}${path}`, { ...init, headers, targetAddressSpace: "loopback" } as RequestInit);
}

const EMPTY: State = { token: null, status: "unpaired", protocol: null, version: null, models: [], folders: [], checking: false, checkedAt: 0 };
let store: State | null = null;
let inflight: Promise<BridgeStatus> | null = null;
const subscribers = new Set<() => void>();

/** The model list from the last good probe, so an offline bridge can still show its models (disabled). */
function cachedModels(): BridgeModel[] {
  try {
    const list = JSON.parse(localStorage.getItem(MODELS_KEY) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const current = (): State => (store ??= { ...EMPTY, token: readBridgeToken(), models: readBridgeToken() ? cachedModels() : [] });
function publish(next: Partial<State>) {
  store = { ...current(), ...next };
  subscribers.forEach((f) => f());
}
function subscribe(f: () => void) {
  subscribers.add(f);
  return () => void subscribers.delete(f);
}

async function loopbackDenied(): Promise<boolean> {
  for (const name of ["loopback-network", "local-network-access"]) {
    try {
      if ((await navigator.permissions.query({ name: name as PermissionName })).state === "denied") return true;
    } catch {
      // permission name unknown to this browser
    }
  }
  return false;
}

const safariOnHttps = () => location.protocol === "https:" && /Safari\//.test(navigator.userAgent) && !/Chrome\/|Chromium\/|Firefox\/|Android/.test(navigator.userAgent);

async function probe(): Promise<BridgeStatus> {
  const token = readBridgeToken();
  if (!token) {
    publish({ ...EMPTY, token: null, checkedAt: Date.now() });
    return "unpaired";
  }
  publish({ token, checking: true });
  let outcome: ProbeOutcome;
  try {
    const res = await bridgeFetch("/health", { signal: AbortSignal.timeout(4000) }, token);
    outcome = { kind: "response", ok: res.ok, body: await res.json().catch(() => null) };
  } catch (e) {
    const name = e instanceof Error ? e.name : undefined;
    // A timeout means nothing is listening: offline, not blocked.
    outcome = name === "TimeoutError" ? { kind: "response", ok: false, body: null } : { kind: "rejected", errorName: name, permissionDenied: await loopbackDenied(), safariOnHttps: safariOnHttps() };
  }
  const h = bridgeStatus(true, outcome);
  let models = current().models;
  let folders: Folder[] = [];
  // no-claude: the bridge has no Claude Code, but it still lists and serves local models.
  if (h.status === "ready" || h.status === "no-claude") {
    const get = (path: string) => bridgeFetch(path, { signal: AbortSignal.timeout(4000) }, token).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [m, f] = await Promise.all([get("/models"), get("/folders")]);
    models = Array.isArray(m?.models) ? m.models : [];
    try {
      localStorage.setItem(MODELS_KEY, JSON.stringify(models));
    } catch {
      // storage blocked
    }
    folders = Array.isArray(f?.folders) ? f.folders : [];
  }
  publish({ ...h, models, folders, checking: false, checkedAt: Date.now() });
  return h.status;
}

/** Probes the bridge now. Calls close together share one probe; `maxAgeMs` accepts a recent answer. */
export function checkBridge(maxAgeMs = 0): Promise<BridgeStatus> {
  const s = current();
  if (maxAgeMs && s.checkedAt && Date.now() - s.checkedAt < maxAgeMs && !inflight) return Promise.resolve(s.status);
  inflight ??= probe().finally(() => {
    inflight = null;
  });
  return inflight;
}

export const bridgeSnapshot = current;

export function saveBridgeToken(token: string) {
  const t = token.trim();
  if (!t) return Promise.resolve<BridgeStatus>("unpaired");
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {
    // storage blocked: the token lives for this probe only
  }
  publish({ ...EMPTY, token: t, models: cachedModels() });
  return checkBridge();
}

export function forgetBridgeToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(MODELS_KEY);
  } catch {
    // nothing stored
  }
  publish({ ...EMPTY, token: null, checkedAt: Date.now() });
}

/** The bridge's state for the whole page. Reading it never probes; see `useBridgeProbe` and `checkBridge`. */
export function useBridge() {
  const s = useSyncExternalStore(subscribe, current, () => EMPTY);
  return { ...s, hasToken: !!s.token, check: checkBridge };
}

/** Probes once (if a token is stored and nothing has probed yet) when `enabled` turns true. */
export function useBridgeProbe(enabled: boolean) {
  useEffect(() => {
    if (enabled && current().token && !current().checkedAt) void checkBridge();
  }, [enabled]);
}

// ─── Working folder chosen in bridge mode (kept in this browser; the server cannot validate it) ───

const folderKey = (conversationId: string) => `orrery:bridge-folder:${conversationId}`;
const FOLDER_EVENT = "orrery:bridge-folder";

export function getBridgeFolder(conversationId: string): string | null {
  try {
    return localStorage.getItem(folderKey(conversationId)) || null;
  } catch {
    return null;
  }
}

export function setBridgeFolder(conversationId: string, folder: string | null) {
  try {
    if (folder) localStorage.setItem(folderKey(conversationId), folder);
    else localStorage.removeItem(folderKey(conversationId));
    // A new folder means this chat's "Allow for this chat" choices no longer apply.
    localStorage.removeItem(`vas:allow:${conversationId}`);
  } catch {
    // storage blocked
  }
  window.dispatchEvent(new Event(FOLDER_EVENT));
}

export function useBridgeFolder(conversationId: string): string | null {
  return useSyncExternalStore(
    (f) => {
      window.addEventListener(FOLDER_EVENT, f);
      window.addEventListener("storage", f);
      return () => {
        window.removeEventListener(FOLDER_EVENT, f);
        window.removeEventListener("storage", f);
      };
    },
    () => getBridgeFolder(conversationId),
    () => null,
  );
}
