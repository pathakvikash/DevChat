"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { StickyNote, Pencil, X, Check, Trash2, Search, MessageSquare } from "lucide-react";
import AppShell, { SidebarToggleButton } from "@/app/components/AppShell";

interface NoteEntry {
  id: string;
  title: string;
  note: string;
  updatedAt: string;
}

export default function NotesPage() {
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => { fetchNotes(); }, []);

  async function fetchNotes() {
    try {
      setLoading(true);
      const res = await fetch("/api/conversations?hasNote=true");
      if (res.ok) {
        const data = await res.json();
        setNotes(data.filter((c: any) => c.note));
      }
    } catch (e) {
      console.error("Failed to load notes:", e);
    } finally {
      setLoading(false);
    }
  }

  async function saveNote(id: string, note: string) {
    await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
  }

  function startEdit(n: NoteEntry) {
    setEditingId(n.id);
    setEditValue(n.note);
  }

  async function saveEdit(n: NoteEntry) {
    await saveNote(n.id, editValue);
    setNotes((prev) =>
      prev.map((x) =>
        x.id === n.id ? { ...x, note: editValue } : x
      )
    );
    setEditingId(null);
    setEditValue("");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue("");
  }

  async function clearNote(id: string) {
    await saveNote(id, "");
    setNotes((prev) => prev.filter((x) => x.id !== id));
  }

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return notes;
    const q = searchQuery.toLowerCase();
    return notes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.note.toLowerCase().includes(q)
    );
  }, [notes, searchQuery]);

  return (
    <AppShell>
        <main className="text-[var(--foreground)] p-8 min-h-full">
          <div className="max-w-4xl mx-auto">
            <div className="sticky top-0 z-10 bg-[var(--background)] -mt-8 pt-8 flex items-start justify-between mb-2">
              <div className="flex items-center gap-3 min-w-0">
                <SidebarToggleButton />
                <StickyNote size={28} className="text-amber-400 shrink-0" />
                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold">Chats Notes</h1>
              </div>
            </div>
            <p className="text-sm text-zinc-400 mb-6">
              Notes attached to your conversations. Editable from here or the scratchpad panel.
            </p>

            <div className="relative mb-6">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                placeholder="Search notes…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full glass-input rounded-[var(--glass-radius-md)] pl-9 pr-3 py-2 text-sm"
              />
            </div>

            {loading ? (
              <p className="text-zinc-400">Loading…</p>
            ) : filtered.length === 0 ? (
              <div className="glass-card rounded-[var(--glass-radius-xl)] p-12 text-center border-dashed">
                <StickyNote size={32} className="text-zinc-600 mx-auto mb-3" />
                <p className="text-zinc-400">
                  {searchQuery
                    ? "No notes match your search."
                    : "No notes yet. Open the scratchpad in any conversation to add one."}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filtered.map((n) => (
                  <div
                    key={n.id}
                    className="glass-card rounded-[var(--glass-radius-lg)] p-4 transition"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <Link
                          href={`/c/${n.id}`}
                          className="flex items-center gap-2 text-sm font-medium text-zinc-200 hover:text-amber-300 transition mb-2"
                        >
                          <MessageSquare size={14} className="shrink-0" />
                          <span className="truncate">{n.title}</span>
                        </Link>
                        {editingId === n.id ? (
                          <textarea
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            rows={4}
                            className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm"
                            autoFocus
                          />
                        ) : (
                          <p className="text-zinc-300 text-sm whitespace-pre-wrap break-words">
                            {n.note}
                          </p>
                        )}
                        <p className="text-[10px] text-zinc-500 mt-2">
                          updated {new Date(n.updatedAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        {editingId === n.id ? (
                          <>
                            <button
                              onClick={() => saveEdit(n)}
                              className="p-1.5 rounded glass-button text-green-400"
                              title="Save"
                            >
                              <Check size={14} />
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="p-1.5 rounded glass-button text-zinc-400"
                              title="Cancel"
                            >
                              <X size={14} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => startEdit(n)}
                              className="p-1.5 rounded glass-button text-zinc-400"
                              title="Edit"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => clearNote(n.id)}
                              className="p-1.5 rounded glass-button text-zinc-400 hover:text-red-400"
                              title="Clear note"
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
    </AppShell>
  );
}
