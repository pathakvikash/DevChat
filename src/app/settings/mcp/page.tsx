"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  Plus, Trash2, Plug, PlugZap, Eye, Cable, ArrowLeft, Loader2, XCircle,
  Wifi, WifiOff, Bot, Mail, MessageSquare, Monitor, Building2, LogIn, ExternalLink,
} from "lucide-react";
import Link from "next/link";
import AppShell, { SidebarToggleButton } from "@/app/components/AppShell";
import CenteredDialog from "@/app/components/ui/CenteredDialog";
import { useToast } from "@/app/components/Toast";

interface McpServer {
  id: string; name: string; url: string; authType: string;
  authConfig?: string; hasAuthToken: boolean; enabled: boolean;
  errorMsg?: string | null; lastPingAt?: string | null; createdAt: string;
}

interface McpTool { name: string; description?: string; inputSchema?: unknown; }

type AuthType = "none" | "apikey" | "oauth2";

interface ServerForm {
  name: string; url: string; authType: AuthType;
  apiKey: string; clientId: string; clientSecret: string; scopes: string;
}

const EMPTY_FORM: ServerForm = {
  name: "", url: "", authType: "none", apiKey: "",
  clientId: "", clientSecret: "", scopes: "",
};

interface Preset {
  name: string; description: string; icon: typeof Bot;
  form: Partial<ServerForm>; needsAuth: "oauth" | "apikey" | "none";
}

const PRESETS: Preset[] = [
  {
    name: "GitHub", description: "Repos, PRs, issues, and search",
    icon: Bot,
    form: { name: "github", url: "http://github-mcp/mcp", authType: "oauth2", scopes: "repo read:user" },
    needsAuth: "oauth",
  },
  {
    name: "Gmail", description: "Read, send, and manage emails",
    icon: Mail,
    form: { name: "gmail", url: "http://gmail-mcp/mcp", authType: "oauth2", scopes: "https://www.googleapis.com/auth/gmail.modify" },
    needsAuth: "oauth",
  },
  {
    name: "Slack", description: "Messages, channels, and users",
    icon: MessageSquare,
    form: { name: "slack", url: "http://slack-mcp/mcp", authType: "oauth2", scopes: "channels:read chat:write users:read" },
    needsAuth: "oauth",
  },
  {
    name: "Playwright", description: "Browser automation and scraping",
    icon: Monitor,
    form: { name: "playwright", url: "http://playwright-mcp/mcp", authType: "none" },
    needsAuth: "none",
  },
  {
    name: "SAP", description: "Business data and processes",
    icon: Building2,
    form: { name: "sap", url: "http://sap-mcp/mcp", authType: "oauth2", scopes: "openid api-access" },
    needsAuth: "oauth",
  },
];

function authLabel(authType: string): string {
  switch (authType) {
    case "apikey": return "API Key";
    case "oauth2": return "OAuth2";
    default: return "None";
  }
}

export default function McpSettingsPage() {
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ServerForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [toolsDialog, setToolsDialog] = useState<{ server: McpServer; tools: McpTool[]; loading: boolean } | null>(null);

  const activePreset = !editingId
    ? PRESETS.find((p) => p.form.name === form.name && p.form.url === form.url)
    : undefined;

  useEffect(() => {
    const oauth = searchParams.get("oauth");
    const reason = searchParams.get("reason");
    if (oauth === "success") {
      toast("OAuth2 authorization successful", "success");
      window.history.replaceState({}, "", "/settings/mcp");
    } else if (oauth === "error") {
      toast(reason ? `Authorization failed: ${reason}` : "Authorization failed", "error");
      window.history.replaceState({}, "", "/settings/mcp");
    }
  }, [searchParams, toast]);

  const fetchServers = useCallback(async () => {
    try {
      const res = await fetch("/api/mcp/servers");
      if (res.ok) setServers(await res.json());
    } catch (e) {
      console.error("Failed to fetch MCP servers:", e);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchServers(); }, [fetchServers]);

  function openAddForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEditForm(server: McpServer) {
    setEditingId(server.id);
    let apiKey = "", clientId = "", clientSecret = "", scopes = "";
    if (server.authConfig) {
      try {
        const cfg = JSON.parse(server.authConfig);
        apiKey = cfg.apiKey || "";
        clientId = cfg.clientId || "";
        clientSecret = cfg.clientSecret || "";
        scopes = cfg.scopes || "";
      } catch {}
    }
    setForm({
      name: server.name, url: server.url,
      authType: (server.authType as AuthType) || "none",
      apiKey, clientId, clientSecret, scopes,
    });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.name.trim() || !form.url.trim()) {
      toast("Name and URL are required", "error"); return;
    }
    setSaving(true);
    try {
      const authConfig: Record<string, string> = {};
      if (form.authType === "apikey" && form.apiKey) authConfig.apiKey = form.apiKey;
      if (form.authType === "oauth2") {
        if (form.clientId) authConfig.clientId = form.clientId;
        if (form.clientSecret) authConfig.clientSecret = form.clientSecret;
        if (form.scopes) authConfig.scopes = form.scopes;
      }
      const body: Record<string, unknown> = {
        name: form.name.trim(), url: form.url.trim(), authType: form.authType,
      };
      if (Object.keys(authConfig).length > 0) body.authConfig = authConfig;

      if (editingId) {
        const res = await fetch(`/api/mcp/servers/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Failed to update server"); }
        toast("Server updated", "success");
      } else {
        const res = await fetch("/api/mcp/servers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Failed to create server"); }
        toast("Server created", "success");
      }
      setShowForm(false);
      fetchServers();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed", "error");
    } finally { setSaving(false); }
  }

  async function handleAuthorizeAndConnect() {
    if (!form.name.trim() || !form.url.trim()) {
      toast("Name and URL are required", "error"); return;
    }
    if (!form.clientId.trim()) {
      toast("Client ID is required — create an OAuth app with the provider", "error"); return;
    }
    setSaving(true);
    try {
      const authConfig: Record<string, string> = { clientId: form.clientId.trim() };
      if (form.clientSecret) authConfig.clientSecret = form.clientSecret;
      if (form.scopes) authConfig.scopes = form.scopes;

      const res = await fetch("/api/mcp/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(), url: form.url.trim(),
          authType: "oauth2", authConfig,
        }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Failed to create server"); }
      const server = await res.json();
      setShowForm(false);
      window.location.href = `/api/mcp/servers/${server.id}/oauth/authorize`;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed", "error");
    } finally { setSaving(false); }
  }

  async function handleDelete(server: McpServer) {
    if (!confirm(`Delete MCP server "${server.name}"?`)) return;
    try {
      const res = await fetch(`/api/mcp/servers/${server.id}`, { method: "DELETE" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Delete failed"); }
      toast("Server deleted", "success");
      setServers((prev) => prev.filter((s) => s.id !== server.id));
    } catch (e) { toast(e instanceof Error ? e.message : "Delete failed", "error"); }
  }

  async function handleToggleEnabled(server: McpServer) {
    const newEnabled = !server.enabled;
    try {
      const res = await fetch(`/api/mcp/servers/${server.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newEnabled }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Toggle failed"); }
      setServers((prev) => prev.map((s) => s.id === server.id ? { ...s, enabled: newEnabled } : s));
      toast(newEnabled ? "Server enabled" : "Server disabled", "success");
    } catch (e) { toast(e instanceof Error ? e.message : "Toggle failed", "error"); }
  }

  async function handleTestConnection(server: McpServer) {
    setTestingId(server.id);
    try {
      const res = await fetch(`/api/mcp/servers/${server.id}/test`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        toast("Connection successful", "success");
        setServers((prev) => prev.map((s) => s.id === server.id ? { ...s, errorMsg: null } : s));
      } else {
        toast(data.error || "Connection failed", "error");
        setServers((prev) => prev.map((s) => s.id === server.id ? { ...s, errorMsg: data.error } : s));
      }
    } catch (e) { toast("Connection test failed", "error"); }
    finally { setTestingId(null); }
  }

  async function handleViewTools(server: McpServer) {
    setToolsDialog({ server, tools: [], loading: true });
    try {
      const res = await fetch(`/api/mcp/servers/${server.id}/tools`);
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Failed to list tools"); }
      const data = await res.json();
      setToolsDialog({ server, tools: data.tools || [], loading: false });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to list tools", "error");
      setToolsDialog(null);
    }
  }

  const embed = searchParams.get("embed") === "1";

  const content = (
      <>
        <main className="text-[var(--foreground)] p-8">
          <div className="sticky top-0 z-10 bg-[var(--background)] -mt-8 pt-8 flex items-center justify-between gap-3 flex-wrap mb-8">
            <div className="flex items-center gap-4 min-w-0">
              {!embed && <SidebarToggleButton />}
              {!embed && (
                <Link href="/settings" className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition shrink-0">
                  <ArrowLeft size={16} /> Settings
                </Link>
              )}
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold">MCP Servers</h1>
            </div>
            <button onClick={openAddForm}
              className="flex items-center gap-2 glass-button-primary text-white rounded-[var(--glass-radius-md)] px-5 py-2.5 font-medium"
            ><Plus size={18} /> Add Server</button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={32} className="animate-spin text-zinc-500" />
            </div>
          ) : servers.length === 0 ? (
            <div className="glass-card rounded-[var(--glass-radius-xl)] p-12 text-center">
              <Cable size={48} className="mx-auto mb-4 text-zinc-500" />
              <h2 className="text-xl font-semibold mb-2">No MCP Servers</h2>
              <p className="text-zinc-400 mb-6 max-w-md mx-auto">
                Add a Model Context Protocol server to give the AI access to external tools and data sources.
              </p>
              <button onClick={openAddForm}
                className="glass-button-primary text-white px-5 py-2.5 rounded-[var(--glass-radius-md)] font-medium"
              ><Plus size={18} className="inline mr-1.5" /> Add Your First Server</button>
            </div>
          ) : (
            <div className="space-y-4 max-w-4xl">
              {servers.map((server) => (
                <div key={server.id} className="glass-card rounded-[var(--glass-radius-xl)] p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="text-lg font-semibold truncate">{server.name}</h3>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${server.enabled ? "bg-emerald-900/40 text-emerald-300" : "bg-zinc-800 text-zinc-400"}`}>
                          {server.enabled ? <><PlugZap size={12} /> Enabled</> : <><Plug size={12} /> Disabled</>}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">{authLabel(server.authType)}</span>
                        {server.authType === "oauth2" && server.hasAuthToken && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-900/40 text-blue-300">
                            <LogIn size={12} /> Connected
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-zinc-400 font-mono truncate">{server.url}</p>
                      {server.errorMsg && (
                        <p className="text-xs text-red-400 mt-1.5 flex items-center gap-1"><XCircle size={12} /> {server.errorMsg}</p>
                      )}
                      {server.authType === "oauth2" && !server.hasAuthToken && (
                        <p className="text-xs text-amber-400 mt-1.5 flex items-center gap-1">
                          <LogIn size={12} /> Not authorized
                        </p>
                      )}
                      {server.lastPingAt && (
                        <p className="text-xs text-zinc-500 mt-1">Last ping: {new Date(server.lastPingAt).toLocaleString()}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => handleTestConnection(server)} disabled={testingId === server.id}
                        className="glass-button text-zinc-300 rounded-[var(--glass-radius-md)] px-3 py-2 text-xs" title="Test connection">
                        {testingId === server.id ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
                      </button>
                      <button onClick={() => handleViewTools(server)}
                        className="glass-button text-zinc-300 rounded-[var(--glass-radius-md)] px-3 py-2 text-xs" title="View tools">
                        <Eye size={14} />
                      </button>
                      {server.authType === "oauth2" && (
                        <a href={`/api/mcp/servers/${server.id}/oauth/authorize`}
                          className={`glass-button rounded-[var(--glass-radius-md)] px-3 py-2 text-xs inline-flex items-center gap-1 ${server.hasAuthToken ? "text-blue-300" : "text-amber-300"}`}
                          title={server.hasAuthToken ? "Re-authorize" : "Authorize"}>
                          <LogIn size={14} /> {server.hasAuthToken ? "Re-auth" : "Auth"}
                        </a>
                      )}
                      <button onClick={() => handleToggleEnabled(server)}
                        className={`glass-button rounded-[var(--glass-radius-md)] px-3 py-2 text-xs ${server.enabled ? "text-red-300" : "text-emerald-300"}`}
                        title={server.enabled ? "Disable" : "Enable"}>
                        {server.enabled ? <WifiOff size={14} /> : <Wifi size={14} />}
                      </button>
                      <button onClick={() => openEditForm(server)}
                        className="glass-button text-zinc-300 rounded-[var(--glass-radius-md)] px-3 py-2 text-xs">Edit</button>
                      <button onClick={() => handleDelete(server)}
                        className="glass-button-danger text-red-200 rounded-[var(--glass-radius-md)] px-3 py-2 text-xs"><Trash2 size={14} /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>

      {/* Add/Edit Dialog */}
      <CenteredDialog isOpen={showForm} onClose={() => setShowForm(false)} widthClass="max-w-lg">
        <div className="space-y-5">
          {activePreset?.needsAuth === "oauth" ? (
            <>
              <h2 className="text-xl font-bold">Connect to {activePreset.name}</h2>
              <p className="text-sm text-zinc-400">
                Create an OAuth2 app with {activePreset.name} and enter your credentials below.
                After saving, you'll be redirected to authorize access.
              </p>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Server URL</label>
                <input type="text" value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm font-mono" />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Client ID</label>
                <input type="text" value={form.clientId}
                  onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                  placeholder="from your OAuth app"
                  className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Client Secret</label>
                <input type="password" value={form.clientSecret}
                  onChange={(e) => setForm({ ...form, clientSecret: e.target.value })}
                  placeholder="from your OAuth app"
                  className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Scopes</label>
                <input type="text" value={form.scopes}
                  onChange={(e) => setForm({ ...form, scopes: e.target.value })}
                  className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm" />
                <p className="text-xs text-zinc-500 mt-1">Pre-filled with recommended scopes.</p>
              </div>
              <div className="space-y-2">
                <p className="text-xs text-zinc-500">
                  <ExternalLink size={12} className="inline mr-1" />
                  Set your OAuth app's redirect URI to:
                  <code className="block mt-1 px-2 py-1 rounded bg-zinc-800 text-zinc-300 text-xs font-mono">
                    {typeof window !== "undefined" ? `${window.location.origin}/api/mcp/servers/[id]/oauth/callback` : "..."}
                  </code>
                </p>
              </div>
              <button onClick={handleAuthorizeAndConnect} disabled={saving}
                className="w-full flex items-center justify-center gap-2 glass-button-primary text-white rounded-[var(--glass-radius-md)] px-5 py-3 font-medium disabled:opacity-50">
                {saving ? <><Loader2 size={18} className="animate-spin" /> Connecting...</>
                  : <><LogIn size={18} /> Authorize with {activePreset.name}</>}
              </button>
              <div className="flex items-center justify-between">
                <button onClick={() => { setForm(EMPTY_FORM); }}
                  className="text-sm text-zinc-500 hover:text-zinc-300 transition">Configure manually</button>
                <button onClick={handleSave} disabled={saving}
                  className="glass-button text-zinc-300 rounded-[var(--glass-radius-md)] px-3 py-1.5 text-xs">
                  Save without authorizing
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-xl font-bold">
                {editingId ? "Edit Server" : activePreset ? `Add ${activePreset.name}` : "Add MCP Server"}
              </h2>

              {!editingId && (
                <>
                  <p className="text-sm text-zinc-400">Pick a preset to auto-fill, or configure manually below.</p>
                  <div className="grid grid-cols-2 gap-2">
                    {PRESETS.map((preset) => {
                      const Icon = preset.icon;
                      return (
                        <button key={preset.name}
                          onClick={() => setForm({ ...EMPTY_FORM, ...preset.form })}
                          className={`flex items-center gap-3 p-3 rounded-[var(--glass-radius-md)] text-left text-sm transition border ${
                            form.name === preset.form.name
                              ? "border-blue-500/50 bg-blue-900/20"
                              : "border-zinc-700/50 bg-zinc-800/30 hover:bg-zinc-800/60"
                          }`}>
                          <Icon size={20} className="shrink-0 text-zinc-300" />
                          <div className="min-w-0">
                            <div className="font-medium truncate">{preset.name}</div>
                            <div className="text-xs text-zinc-500 truncate">{preset.description}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <hr className="border-zinc-700/50" />
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Name</label>
                <input type="text" value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="my-server" className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm" />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">URL</label>
                <input type="text" value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="http://localhost:3001/mcp"
                  className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm" />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Auth Type</label>
                <select value={form.authType}
                  onChange={(e) => setForm({ ...form, authType: e.target.value as AuthType })}
                  className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm">
                  <option value="none">None</option>
                  <option value="apikey">API Key</option>
                  <option value="oauth2">OAuth2</option>
                </select>
              </div>

              {form.authType === "apikey" && (
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">API Key</label>
                  <input type="password" value={form.apiKey}
                    onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                    placeholder="sk-..." className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm" />
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button onClick={() => setShowForm(false)}
                  className="glass-button text-zinc-300 rounded-[var(--glass-radius-md)] px-4 py-2 text-sm">Cancel</button>
                <button onClick={handleSave} disabled={saving}
                  className="flex items-center gap-2 glass-button-primary text-white rounded-[var(--glass-radius-md)] px-5 py-2 text-sm font-medium disabled:opacity-50">
                  {saving ? <><Loader2 size={16} className="animate-spin" /> Saving...</>
                    : editingId ? "Update Server" : "Add Server"}
                </button>
              </div>
            </>
          )}
        </div>
      </CenteredDialog>

      {/* Tools Dialog */}
      <CenteredDialog isOpen={!!toolsDialog} onClose={() => setToolsDialog(null)} widthClass="max-w-lg">
        {toolsDialog && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold">Tools: {toolsDialog.server.name}</h2>
            {toolsDialog.loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={24} className="animate-spin text-zinc-500" />
              </div>
            ) : toolsDialog.tools.length === 0 ? (
              <p className="text-zinc-400 py-4 text-center">This server exposes no tools.</p>
            ) : (
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {toolsDialog.tools.map((tool) => (
                  <div key={tool.name} className="p-3 rounded-[var(--glass-radius-md)] bg-zinc-800/50 border border-zinc-700/50">
                    <div className="font-medium text-sm mb-0.5">{tool.name}</div>
                    {tool.description && <p className="text-xs text-zinc-400">{tool.description}</p>}
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end pt-2">
              <button onClick={() => setToolsDialog(null)}
                className="glass-button text-zinc-300 rounded-[var(--glass-radius-md)] px-4 py-2 text-sm">Close</button>
            </div>
          </div>
        )}
      </CenteredDialog>
      </>
  );

  return embed ? content : <AppShell>{content}</AppShell>;
}
