"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Trash2, Plus, Brain, Pencil, X, Check, AlertTriangle, Pin, PinOff, Download, Upload, BarChart3, Search } from "lucide-react";
import AppShell, { SidebarToggleButton } from "@/app/components/AppShell";
import { downloadBlob } from "@/lib/utils/download";

interface Memory {
  id: string;
  key: string;
  value: string;
  category: string;
  pinned: boolean;
  confidence: number;
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const CATEGORIES = ["profile", "preference", "project", "context", "general"];

export default function MemoryPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newCategory, setNewCategory] = useState("profile");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => { fetchMemories(); }, []);

  async function fetchMemories() {
    try {
      setLoading(true);
      const res = await fetch("/api/memory");
      if (res.ok) setMemories(await res.json());
    } catch (e) {
      console.error("Failed to load memories:", e);
    } finally {
      setLoading(false);
    }
  }

  async function saveMemory(key: string, value: string, category: string) {
    const res = await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value, category }),
    });
    if (res.ok) await fetchMemories();
  }

  async function togglePin(m: Memory) {
    await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: m.key, value: m.value, category: m.category, pinned: !m.pinned }),
    });
    await fetchMemories();
  }

  async function deleteMemory(id: string) {
    const mem = memories.find((m) => m.id === id);
    if (!mem) return;
    if (!confirm(`Forget memory "${mem.key}"?`)) return;
    await fetch(`/api/memory?key=${encodeURIComponent(mem.key)}`, { method: "DELETE" });
    await fetchMemories();
  }

  async function clearAll() {
    if (!confirm("Forget ALL memories? This cannot be undone.")) return;
    await fetch("/api/memory?all=1", { method: "DELETE" });
    await fetchMemories();
  }

  async function handleAdd() {
    if (!newKey.trim() || !newValue.trim()) return;
    await saveMemory(newKey.trim(), newValue.trim(), newCategory);
    setNewKey(""); setNewValue(""); setNewCategory("profile"); setAdding(false);
  }

  async function startEdit(m: Memory) { setEditingId(m.id); setEditValue(m.value); }
  async function saveEdit(m: Memory) {
    if (!editValue.trim()) return;
    await saveMemory(m.key, editValue.trim(), m.category);
    setEditingId(null); setEditValue("");
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(memories, null, 2)], { type: "application/json" });
    downloadBlob(blob, "vas-memories.json");
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        const arr = Array.isArray(data) ? data : [];
        for (const m of arr) {
          if (m.key && m.value) {
            await fetch("/api/memory", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key: m.key, value: m.value, category: m.category || "general", pinned: !!m.pinned }),
            });
          }
        }
        await fetchMemories();
      } catch { console.error("Import failed"); }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return memories;
    const q = searchQuery.toLowerCase();
    return memories.filter((m) =>
      m.key.toLowerCase().includes(q) ||
      m.value.toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q),
    );
  }, [memories, searchQuery]);

  const grouped = useMemo(() => {
    const out: Record<string, Memory[]> = {};
    for (const m of filtered) (out[m.category] ||= []).push(m);
    return out;
  }, [filtered]);

  const pinnedCount = useMemo(() => memories.filter((m) => m.pinned).length, [memories]);
  const avgConfidence = useMemo(() => {
    if (memories.length === 0) return 0;
    return memories.reduce((s, m) => s + m.confidence, 0) / memories.length;
  }, [memories]);
  const topUsed = useMemo(() => {
    return [...memories].sort((a, b) => b.useCount - a.useCount).slice(0, 5);
  }, [memories]);
  const catDistribution = useMemo(() => {
    const out: Record<string, number> = {};
    for (const m of memories) out[m.category] = (out[m.category] || 0) + 1;
    return out;
  }, [memories]);

  const embed = useSearchParams().get("embed") === "1";

  const content = (
        <main className="text-[var(--foreground)] p-8 min-h-full">
          <div className="max-w-4xl mx-auto">
            <div className="sticky top-0 z-10 bg-[var(--background)] -mt-8 pt-8 flex items-start justify-between gap-3 flex-wrap mb-2">
              <div className="flex items-center gap-3 min-w-0">
                {!embed && <SidebarToggleButton />}
                <Brain size={28} className="text-purple-400 shrink-0" />
                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold">User Memory</h1>
              </div>
              <div className="flex gap-2">
                <button onClick={exportJSON} className="flex items-center gap-2 glass-button text-zinc-300 px-4 py-2 rounded-[var(--glass-radius-md)] text-sm" title="Export all memories as JSON">
                  <Download size={16} /> Export
                </button>
                <label className="flex items-center gap-2 glass-button text-zinc-300 px-4 py-2 rounded-[var(--glass-radius-md)] text-sm cursor-pointer" title="Import memories from JSON">
                  <Upload size={16} /> Import
                  <input type="file" accept=".json" onChange={handleImport} className="hidden" />
                </label>
                <button onClick={() => setAdding(true)} className="flex items-center gap-2 glass-button-primary text-white px-4 py-2 rounded-[var(--glass-radius-md)] text-sm">
                  <Plus size={16} /> Add fact
                </button>
                {memories.length > 0 && (
                  <button onClick={clearAll} className="flex items-center gap-2 glass-button-danger text-red-600 px-4 py-2 rounded-[var(--glass-radius-md)] text-sm">
                    <Trash2 size={16} /> Clear all
                  </button>
                )}
              </div>
            </div>
            <p className="text-sm text-zinc-400 mb-6">
              Persistent facts about you that the model reads every conversation. Pinned facts are always included.
            </p>

            {/* Stats dashboard */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <div className="glass-card rounded-[var(--glass-radius-lg)] p-3">
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Total facts</p>
                <p className="text-2xl font-bold text-zinc-100">{memories.length}</p>
              </div>
              <div className="glass-card rounded-[var(--glass-radius-lg)] p-3">
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Pinned</p>
                <p className="text-2xl font-bold text-amber-400">{pinnedCount}</p>
              </div>
              <div className="glass-card rounded-[var(--glass-radius-lg)] p-3">
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Avg confidence</p>
                <p className="text-2xl font-bold text-zinc-100">{(avgConfidence * 100).toFixed(0)}%</p>
              </div>
              <div className="glass-card rounded-[var(--glass-radius-lg)] p-3">
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Categories</p>
                <p className="text-2xl font-bold text-zinc-100">{Object.keys(catDistribution).length}</p>
              </div>
            </div>

            {/* Top-used & Category distribution */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div className="glass-card rounded-[var(--glass-radius-lg)] p-4">
                <div className="flex items-center gap-2 mb-3">
                  <BarChart3 size={14} className="text-zinc-400" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Most-used facts</h3>
                </div>
                {topUsed.length === 0 ? (
                  <p className="text-xs text-zinc-600">No facts yet</p>
                ) : (
                  <div className="space-y-1.5">
                    {topUsed.map((m) => (
                      <div key={m.id} className="flex items-center justify-between text-xs">
                        <span className="text-zinc-300 truncate mr-2">{m.key}</span>
                        <span className="text-zinc-500 shrink-0">{m.useCount} use{m.useCount !== 1 ? "s" : ""}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="glass-card rounded-[var(--glass-radius-lg)] p-4">
                <div className="flex items-center gap-2 mb-3">
                  <BarChart3 size={14} className="text-zinc-400" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">By category</h3>
                </div>
                {Object.keys(catDistribution).length === 0 ? (
                  <p className="text-xs text-zinc-600">No facts yet</p>
                ) : (
                  <div className="space-y-1.5">
                    {Object.entries(catDistribution).map(([cat, count]) => (
                      <div key={cat} className="flex items-center justify-between text-xs">
                        <span className="text-zinc-300">{cat}</span>
                        <span className="text-zinc-500">{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Search */}
            <div className="relative mb-4">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                placeholder="Search memories…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full glass-input rounded-[var(--glass-radius-md)] pl-9 pr-3 py-2 text-sm"
              />
            </div>

            {adding && (
              <div className="mb-6 glass-card rounded-[var(--glass-radius-lg)] p-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                  <input type="text" placeholder="key (e.g. name, role, project_x)" value={newKey} onChange={(e) => setNewKey(e.target.value)} className="glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm" />
                  <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm">
                    {CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}
                  </select>
                  <div className="md:col-span-1" />
                </div>
                <textarea placeholder="value (the fact in one sentence)" value={newValue} onChange={(e) => setNewValue(e.target.value)} rows={2} className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm mb-3" />
                <div className="flex gap-2">
                  <button onClick={handleAdd} disabled={!newKey.trim() || !newValue.trim()} className="glass-button-primary text-white disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-[var(--glass-radius-md)] text-sm transition">Save</button>
                  <button onClick={() => { setAdding(false); setNewKey(""); setNewValue(""); }} className="glass-button text-zinc-300 px-4 py-2 rounded-[var(--glass-radius-md)] text-sm transition">Cancel</button>
                </div>
              </div>
            )}

            {loading ? (
              <p className="text-zinc-400">Loading…</p>
            ) : filtered.length === 0 ? (
              <div className="glass-card rounded-[var(--glass-radius-xl)] p-12 text-center border-dashed">
                <AlertTriangle size={32} className="text-zinc-600 mx-auto mb-3" />
                <p className="text-zinc-400">
                  {searchQuery ? "No memories match your search." : "No memories yet. Tell the model things like \"remember my name is X\" or click Add fact above."}
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {(searchQuery ? [["results", filtered] as [string, Memory[]]] : Object.entries(grouped)).map(([cat, list]) => (
                  <section key={cat}>
                    <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">{cat} ({list.length})</h2>
                    <div className="space-y-2">
                      {list.map((m) => (
                        <div key={m.id} className={`glass-card rounded-[var(--glass-radius-lg)] p-3 transition ${m.pinned ? "border-amber-700/50" : ""}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <code className="text-xs font-mono text-purple-200 bg-purple-500/15 border border-purple-500/30 px-2 py-0.5 rounded">{m.key}</code>
                                <span className="text-[10px] text-zinc-500">{(m.confidence * 100).toFixed(0)}% confident</span>
                                <span className="text-[10px] text-zinc-500">{m.useCount} use{m.useCount !== 1 ? "s" : ""}</span>
                                {m.pinned && <Pin size={10} className="text-amber-400" />}
                              </div>
                              {editingId === m.id ? (
                                <textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} rows={2} className="mt-2 w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm" />
                              ) : (
                                <p className="mt-2 text-zinc-200 text-sm wrap-break-word">{m.value}</p>
                              )}
                              <p className="text-[10px] text-zinc-500 mt-2">updated {new Date(m.updatedAt).toLocaleString()}</p>
                            </div>
                            <div className="flex flex-col gap-1 shrink-0">
                              <button onClick={() => togglePin(m)} className={`p-1.5 rounded glass-button ${m.pinned ? "text-amber-400" : "text-zinc-500"}`} title={m.pinned ? "Unpin" : "Pin"}>
                                {m.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                              </button>
                              {editingId === m.id ? (
                                <>
                                  <button onClick={() => saveEdit(m)} className="p-1.5 rounded glass-button text-green-400" title="Save"><Check size={14} /></button>
                                  <button onClick={() => setEditingId(null)} className="p-1.5 rounded glass-button text-zinc-400" title="Cancel"><X size={14} /></button>
                                </>
                              ) : (
                                <>
                                  <button onClick={() => startEdit(m)} className="p-1.5 rounded glass-button text-zinc-400" title="Edit"><Pencil size={14} /></button>
                                  <button onClick={() => deleteMemory(m.id)} className="p-1.5 rounded glass-button text-zinc-400 hover:text-red-400" title="Forget"><Trash2 size={14} /></button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </main>
  );

  return embed ? content : <AppShell>{content}</AppShell>;
}
