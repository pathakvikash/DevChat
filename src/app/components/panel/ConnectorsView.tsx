"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useResource } from "@/app/hooks/useResource";
import { useToast } from "@/app/components/Toast";
import { connectHref } from "@/app/components/GoogleConnection";

export interface McpServerRow {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  errorMsg: string | null;
}

export interface GoogleState {
  configured: boolean;
  connected: boolean;
  reconnect: boolean;
}

export async function fetchMcpServers(): Promise<McpServerRow[]> {
  const res = await fetch("/api/mcp/servers");
  if (!res.ok) throw new Error(`Failed to load connectors: ${res.status}`);
  return res.json();
}

export async function fetchGoogleState(): Promise<GoogleState | null> {
  const res = await fetch("/api/integrations/google").catch(() => null);
  return res?.ok ? res.json() : null;
}

/** Dot colour: grey when off, amber when the last check failed, green otherwise. */
export const serverDot = (s: McpServerRow) => (!s.enabled ? "bg-zinc-500" : s.errorMsg ? "bg-amber-400" : "bg-emerald-500");

export function googleLabel(g: GoogleState | null): string {
  if (!g) return "Unavailable";
  if (!g.configured) return "Not set up on this server";
  if (g.reconnect) return "Reconnect needed";
  return g.connected ? "Connected" : "Not connected";
}

export default function ConnectorsView() {
  const { toast } = useToast();
  const pathname = usePathname();
  const servers = useResource<McpServerRow[]>(fetchMcpServers, []);
  const google = useResource<GoogleState | null>(fetchGoogleState, []);
  const [tools, setTools] = useState<Record<string, number | "error">>({});
  const [busy, setBusy] = useState<string | null>(null);

  const list = servers.data;
  // Tool counts come from each enabled server's own connection, so they load one by one.
  const idsKey = (list ?? []).filter((s) => s.enabled).map((s) => s.id).join(",");
  useEffect(() => {
    let live = true;
    for (const id of idsKey ? idsKey.split(",") : []) {
      fetch(`/api/mcp/servers/${id}/tools`)
        .then(async (r) => (r.ok ? ((await r.json()).tools?.length ?? 0) : "error"))
        .catch(() => "error" as const)
        .then((n) => live && setTools((t) => ({ ...t, [id]: n })));
    }
    return () => {
      live = false;
    };
  }, [idsKey]);

  const test = useCallback(
    async (s: McpServerRow) => {
      setBusy(s.id);
      try {
        const res = await fetch(`/api/mcp/servers/${s.id}/test`, { method: "POST" });
        const body = await res.json().catch(() => ({}));
        toast(body?.ok ? `${s.name}: connection works` : `${s.name}: ${body?.error || "connection failed"}`, body?.ok ? "success" : "error");
        await servers.refetch();
      } finally {
        setBusy(null);
      }
    },
    [toast, servers],
  );

  const toggle = useCallback(
    async (s: McpServerRow) => {
      setBusy(s.id);
      try {
        const res = await fetch(`/api/mcp/servers/${s.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !s.enabled }),
        });
        if (!res.ok) toast(`Couldn't ${s.enabled ? "disable" : "enable"} ${s.name}`, "error");
        await servers.refetch();
      } finally {
        setBusy(null);
      }
    },
    [toast, servers],
  );

  const g = google.data;
  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      <h3 className="px-1 pb-2 text-xs font-semibold uppercase tracking-wider text-[var(--foreground)]/60">MCP servers</h3>
      {servers.loading && !list && <p className="px-1 text-sm text-[var(--foreground)]/60">Loading…</p>}
      {servers.error && <p className="px-1 text-sm text-red-500">Couldn&apos;t load connectors.</p>}
      {list && list.length === 0 && <p className="px-1 text-sm text-[var(--foreground)]/60">No servers yet. Add one in Settings.</p>}
      <ul className="space-y-2" aria-label="MCP servers">
        {(list ?? []).map((s) => (
          <li key={s.id} className="glass-card rounded-[var(--glass-radius-md)] px-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              <span aria-hidden className={`size-2 shrink-0 rounded-full ${serverDot(s)}`} />
              <span className="min-w-0 flex-1 truncate font-medium text-[var(--foreground)]" title={s.url}>{s.name}</span>
              <span className="shrink-0 text-xs text-[var(--foreground)]/60">
                {!s.enabled ? "Off" : tools[s.id] === undefined ? "…" : tools[s.id] === "error" ? "no tools" : `${tools[s.id]} tools`}
              </span>
            </div>
            {s.errorMsg && <p className="mt-1 text-xs text-amber-500 break-words">{s.errorMsg}</p>}
            <div className="mt-1.5 flex gap-1.5">
              <button type="button" disabled={busy === s.id} onClick={() => void test(s)} className="focus-ring h-6 rounded-[var(--glass-radius-sm)] px-2 text-xs glass-button text-[var(--foreground)] disabled:opacity-50">
                {busy === s.id ? "Testing…" : "Test"}
              </button>
              <button type="button" role="switch" aria-checked={s.enabled} aria-label={`${s.name} enabled`} disabled={busy === s.id} onClick={() => void toggle(s)} className="focus-ring h-6 rounded-[var(--glass-radius-sm)] px-2 text-xs glass-button text-[var(--foreground)] disabled:opacity-50">
                {s.enabled ? "Disable" : "Enable"}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <h3 className="px-1 pb-2 pt-5 text-xs font-semibold uppercase tracking-wider text-[var(--foreground)]/60">Google Sheets</h3>
      <div className="glass-card flex items-center gap-2 rounded-[var(--glass-radius-md)] px-3 py-2 text-sm">
        <span aria-hidden className={`size-2 shrink-0 rounded-full ${g?.connected && !g.reconnect ? "bg-emerald-500" : g?.reconnect ? "bg-amber-400" : "bg-zinc-500"}`} />
        <span className="flex-1 text-[var(--foreground)]">{googleLabel(g)}</span>
        {g?.configured && (!g.connected || g.reconnect) && (
          // A full navigation: the connect route redirects to Google and back.
          <a href={connectHref(pathname)} className="focus-ring rounded-[var(--glass-radius-sm)] px-2 py-1 text-xs glass-button text-[var(--foreground)]">
            {g.reconnect ? "Reconnect" : "Connect"}
          </a>
        )}
      </div>

      <Link href="/settings/mcp" className="focus-ring mt-5 inline-block rounded text-xs text-[var(--foreground)]/70 underline hover:text-[var(--foreground)]">
        Manage in Settings
      </Link>
    </div>
  );
}
