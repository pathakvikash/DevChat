"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AppWindow, ArrowLeft, Check, Copy, Loader2, Plus, RefreshCw, ShieldAlert, ShieldCheck, Trash2, XCircle,
} from "lucide-react";
import AppShell, { SidebarToggleButton } from "@/app/components/AppShell";
import { useToast } from "@/app/components/Toast";
import { AppIcon } from "@/app/components/AppIcon";
import type { AppManifest, AppRecord, AppTool } from "@/lib/apps/types";
import { envSnippet, groupTools, permissionCopy } from "@/lib/apps/ui";

interface Preview { manifest: AppManifest; origin: string; tools: AppTool[]; toolsUnavailable?: boolean; warnings: string[] }

const JSON_HEADERS = { "Content-Type": "application/json" };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `Request failed (${res.status})`), { status: res.status });
  return body as T;
}

function PermissionBadge({ permission }: { permission: AppRecord["permission"] }) {
  const actions = permission === "actions";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${actions ? "bg-[var(--warn-bg)] text-[var(--warn-text)]" : "bg-[var(--ok-bg)] text-[var(--ok-text)]"}`}>
      {actions ? <ShieldAlert size={12} /> : <ShieldCheck size={12} />}
      {permissionCopy(permission).label}
    </span>
  );
}

function ToolList({ tools }: { tools: AppTool[] }) {
  const { readOnly, other } = groupTools(tools);
  if (tools.length === 0) return <p className="text-sm text-zinc-400">This app exposes no tools.</p>;
  const row = (t: AppTool, ro: boolean) => (
    <li key={t.name} className={`p-2 rounded-[var(--glass-radius-md)] border text-sm ${ro ? "border-emerald-900/50 bg-emerald-500/10" : "border-amber-900/50 bg-amber-500/10"}`}>
      <div className="flex items-center gap-2">
        <span className="font-medium font-mono truncate">{t.name}</span>
        <span className={`ml-auto shrink-0 text-xs ${ro ? "text-[var(--ok-text)]" : "text-[var(--warn-text)]"}`}>{ro ? "Read only" : "Asks first"}</span>
      </div>
      {t.description && <p className="text-xs text-zinc-400 mt-0.5">{t.description}</p>}
    </li>
  );
  return <ul className="space-y-2 max-h-72 overflow-y-auto">{[...readOnly.map((t) => row(t, true)), ...other.map((t) => row(t, false))]}</ul>;
}

function SecretBox({ secret, onDone }: { secret: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const snippet = envSnippet(secret);
  async function copy() {
    try { await navigator.clipboard.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked: the text is selectable */ }
  }
  return (
    <div className="glass-card rounded-[var(--glass-radius-xl)] p-5 border border-amber-900/50 space-y-3" data-testid="app-secret-box">
      <h3 className="text-lg font-semibold">App added. Copy its secret now.</h3>
      <p className="text-sm text-[var(--warn-text)] flex items-start gap-2"><ShieldAlert size={16} className="shrink-0 mt-0.5" />
        This secret will not be shown again. Paste these two lines into the app&apos;s environment variables and redeploy it.</p>
      <pre className="rounded-[var(--glass-radius-md)] bg-zinc-800/60 border border-zinc-700/50 p-3 text-xs font-mono overflow-x-auto select-all" data-testid="app-secret-text">{snippet}</pre>
      <div className="flex justify-end gap-2">
        <button onClick={copy} className="glass-button text-zinc-300 rounded-[var(--glass-radius-md)] px-3 py-2 text-sm flex items-center gap-2">
          {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
        </button>
        <button onClick={onDone} className="glass-button-primary text-white rounded-[var(--glass-radius-md)] px-4 py-2 text-sm font-medium">I have saved it</button>
      </div>
    </div>
  );
}

function AppsContent() {
  const embed = useSearchParams().get("embed") === "1";
  const { toast } = useToast();
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [readOnlyMode, setReadOnlyMode] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [url, setUrl] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saving, setSaving] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // `all=1` asks for apps waiting for approval too; the list for ordinary users only has approved ones.
      const data = await call<AppRecord[] | { apps: AppRecord[]; owner?: boolean }>("/api/apps?all=1");
      setApps(Array.isArray(data) ? data : data.apps);
      if (!Array.isArray(data) && data.owner === false) setReadOnlyMode(true);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load apps");
    } finally { setLoading(false); }
  }, []);

  // First load: state is set from the promise callbacks (not in the effect body), `load` is for refreshes.
  useEffect(() => {
    let alive = true;
    call<AppRecord[] | { apps: AppRecord[]; owner?: boolean }>("/api/apps?all=1")
      .then((data) => { if (alive) { setApps(Array.isArray(data) ? data : data.apps); if (!Array.isArray(data) && data.owner === false) setReadOnlyMode(true); setLoadError(null); } })
      .catch((e) => { if (alive) setLoadError(e instanceof Error ? e.message : "Failed to load apps"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  function fail(e: unknown, fallback: string) {
    if ((e as { status?: number }).status === 403) setReadOnlyMode(true);
    return e instanceof Error ? e.message : fallback;
  }

  async function runPreview(raw = url) {
    const base = raw.trim().replace(/\/+$/, "");
    if (!base) return;
    setPreviewing(true); setPreviewError(null); setPreview(null);
    try {
      setPreview(await call<Preview>("/api/apps/preview", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ url: base }) }));
    } catch (e) { setPreviewError(fail(e, "Could not read the app")); }
    finally { setPreviewing(false); }
  }

  async function approve() {
    if (!preview) return;
    setSaving(true);
    try {
      const out = await call<{ app: AppRecord; secret: string }>("/api/apps", {
        method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ url: url.trim().replace(/\/+$/, ""), approve: true }),
      });
      setSecret(out.secret); setPreview(null); setUrl("");
      void load();
    } catch (e) { toast(fail(e, "Could not add the app"), "error"); }
    finally { setSaving(false); }
  }

  async function refresh(app: AppRecord) {
    setBusyId(app.id);
    try {
      await call(`/api/apps/${app.id}/refresh`, { method: "POST" });
      toast("App refreshed", "success");
      await load();
    } catch (e) { toast(fail(e, "Refresh failed"), "error"); }
    finally { setBusyId(null); }
  }

  async function remove(app: AppRecord) {
    if (!confirm(`Remove "${app.name}"? Its secret stops working and chats lose its tools.`)) return;
    setBusyId(app.id);
    try {
      await call(`/api/apps/${app.id}`, { method: "DELETE" });
      setApps((prev) => prev.filter((a) => a.id !== app.id));
      toast("App removed", "success");
    } catch (e) { toast(fail(e, "Remove failed"), "error"); }
    finally { setBusyId(null); }
  }

  const perm = preview ? permissionCopy(preview.manifest.permission) : null;

  const content = (
    <main className="text-[var(--foreground)] p-4 sm:p-8">
      <div className="sticky top-0 z-10 bg-[var(--background)] -mt-4 sm:-mt-8 pt-4 sm:pt-8 flex items-center gap-4 flex-wrap mb-8">
        {!embed && <SidebarToggleButton />}
        {!embed && (
          <Link href="/settings" className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition shrink-0">
            <ArrowLeft size={16} /> Settings
          </Link>
        )}
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold">Apps</h1>
      </div>

      <div className="space-y-6 max-w-4xl">
        {readOnlyMode && (
          <p role="note" className="glass-card rounded-[var(--glass-radius-md)] px-4 py-3 text-sm text-zinc-300">
            Only the server owner can add, refresh or remove apps. You can see the list and open apps from the sidebar.
          </p>
        )}

        {secret && <SecretBox secret={secret} onDone={() => setSecret(null)} />}

        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 size={28} className="animate-spin text-zinc-500" /></div>
        ) : loadError ? (
          <div className="glass-card rounded-[var(--glass-radius-xl)] p-6 text-center">
            <p className="text-sm text-[var(--danger-text)] flex items-center justify-center gap-1 mb-3"><XCircle size={14} /> {loadError}</p>
            <button onClick={() => { setLoading(true); void load(); }} className="glass-button text-zinc-300 rounded-[var(--glass-radius-md)] px-4 py-2 text-sm">Try again</button>
          </div>
        ) : apps.length === 0 ? (
          <div className="glass-card rounded-[var(--glass-radius-xl)] p-10 text-center">
            <AppWindow size={40} className="mx-auto mb-3 text-zinc-500" />
            <h2 className="text-lg font-semibold mb-1">No apps yet</h2>
            <p className="text-sm text-zinc-400">Add a sibling app below to use its tools in chat and open it from the sidebar.</p>
          </div>
        ) : (
          <ul className="space-y-3" aria-label="Registered apps">
            {apps.map((app) => (
              <li key={app.id} data-testid={`app-row-${app.id}`} className="glass-card rounded-[var(--glass-radius-xl)] p-4 sm:p-5">
                <div className="flex items-start gap-3 flex-wrap sm:flex-nowrap">
                  <AppIcon app={app} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base sm:text-lg font-semibold truncate">{app.name}</h3>
                      <PermissionBadge permission={app.permission} />
                      <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
                        <span aria-hidden="true" className={`size-1.5 rounded-full ${app.status === "ok" ? "bg-emerald-400" : "bg-red-400"}`} />
                        {app.status === "ok" ? "Reachable" : "Unreachable"}
                      </span>
                      {app.approved === false && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--warn-bg)] text-[var(--warn-text)]">Needs approval</span>
                      )}
                    </div>
                    <p className="text-sm text-zinc-400 font-mono truncate">{app.baseUrl}</p>
                    {app.tools && <p className="text-xs text-zinc-400 mt-1">{app.tools.length} tool{app.tools.length === 1 ? "" : "s"}</p>}
                    {app.approved === false && (
                      <p className="text-xs text-[var(--warn-text)] mt-1">Its origin, permission or tools changed. Review it before chats can use it again.</p>
                    )}
                  </div>
                  {!readOnlyMode && (
                    <div className="flex items-center gap-2 shrink-0">
                      {app.approved === false && (
                        <button onClick={() => { setUrl(app.baseUrl); void runPreview(app.baseUrl); }}
                          className="glass-button-primary text-white rounded-[var(--glass-radius-md)] px-3 py-2 text-xs font-medium">Review</button>
                      )}
                      <button onClick={() => refresh(app)} disabled={busyId === app.id}
                        className="glass-button text-zinc-300 rounded-[var(--glass-radius-md)] px-3 py-2 text-xs flex items-center gap-1.5 disabled:opacity-50"
                        aria-label={`Refresh ${app.name}`} title="Refresh">
                        {busyId === app.id ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
                      </button>
                      <button onClick={() => remove(app)} disabled={busyId === app.id}
                        className="glass-button-danger text-[var(--danger-btn-text)] rounded-[var(--glass-radius-md)] px-3 py-2 text-xs flex items-center gap-1.5 disabled:opacity-50"
                        aria-label={`Remove ${app.name}`} title="Remove">
                        <Trash2 size={14} /> Remove
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {!readOnlyMode && !loading && (
          <section className="glass-card rounded-[var(--glass-radius-xl)] p-5 sm:p-6 space-y-4" aria-labelledby="add-app-h">
            <h2 id="add-app-h" className="text-xl font-bold">Add app</h2>
            <form onSubmit={(e) => { e.preventDefault(); void runPreview(); }} className="flex gap-2 flex-wrap sm:flex-nowrap">
              <label className="sr-only" htmlFor="app-url">App URL</label>
              <input id="app-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://printpro3d.vercel.app"
                className="flex-1 min-w-0 glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm font-mono" />
              <button type="submit" disabled={previewing || !url.trim()}
                className="glass-button-primary text-white rounded-[var(--glass-radius-md)] px-4 py-2 text-sm font-medium flex items-center gap-2 disabled:opacity-50">
                {previewing ? <><Loader2 size={16} className="animate-spin" /> Checking...</> : <><Plus size={16} /> Check app</>}
              </button>
            </form>
            <p className="text-xs text-zinc-400">Paste the app&apos;s base URL. Orrery reads <span className="font-mono">/.well-known/orrery-app.json</span> from it and shows what it will allow before anything is saved.</p>
            {previewError && <p role="alert" className="text-sm text-[var(--danger-text)] flex items-center gap-1"><XCircle size={14} /> {previewError}</p>}

            {preview && perm && (
              <div className="rounded-[var(--glass-radius-lg)] border border-zinc-700/50 p-4 space-y-4" data-testid="app-review">
                <div className="flex items-center gap-3">
                  <AppIcon app={{ name: preview.manifest.name, icon: preview.manifest.icon }} size={40} />
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold truncate">{preview.manifest.name}</h3>
                    <p className="text-xs text-zinc-400 font-mono truncate">{preview.origin}</p>
                  </div>
                </div>
                <p className="text-sm text-zinc-300">{preview.manifest.description}</p>
                <div className={`rounded-[var(--glass-radius-md)] border p-3 text-sm ${preview.manifest.permission === "actions" ? "border-amber-900/50 bg-amber-500/10" : "border-emerald-900/50 bg-emerald-500/10"}`}>
                  <PermissionBadge permission={preview.manifest.permission} />
                  <p className="text-zinc-300 mt-2">{perm.detail}</p>
                </div>
                <div>
                  {preview.toolsUnavailable ? (
                    <p className="text-sm text-[var(--warn-text)]" data-testid="tools-unavailable">This app requires a signed request. Its tools are listed after you register it, set its secret in the app, and press Refresh; you then approve the list.</p>
                  ) : (
                    <>
                      <h4 className="text-sm font-medium mb-2">Tools ({preview.tools.length})</h4>
                      <ToolList tools={preview.tools} />
                    </>
                  )}
                </div>
                {preview.warnings.length > 0 && (
                  <ul className="space-y-1" aria-label="Warnings">
                    {preview.warnings.map((w) => <li key={w} className="text-xs text-[var(--warn-text)] flex items-start gap-1"><ShieldAlert size={12} className="shrink-0 mt-0.5" /> {w}</li>)}
                  </ul>
                )}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setPreview(null)} className="glass-button text-zinc-300 rounded-[var(--glass-radius-md)] px-4 py-2 text-sm">Cancel</button>
                  <button onClick={approve} disabled={saving}
                    className="glass-button-primary text-white rounded-[var(--glass-radius-md)] px-5 py-2 text-sm font-medium flex items-center gap-2 disabled:opacity-50">
                    {saving ? <><Loader2 size={16} className="animate-spin" /> Adding...</> : "Approve and add"}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );

  return embed ? content : <AppShell>{content}</AppShell>;
}

export default function AppsSettingsPage() {
  return <Suspense><AppsContent /></Suspense>;
}
