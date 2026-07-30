"use client";

import { useEffect, useState } from "react";
import { Trash2, Upload, FileText } from "lucide-react";
import AppShell, { SidebarToggleButton } from "@/app/components/AppShell";

interface Document {
  id: string;
  filename: string;
  createdAt: string;
}

interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  documents?: Document[];
  _count?: { documents: number };
}

export default function KnowledgeBasePage() {
  const [kbList, setKbList] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKb, setSelectedKb] = useState<KnowledgeBase | null>(null);
  const [showNewKbForm, setShowNewKbForm] = useState(false);
  const [newKbName, setNewKbName] = useState("");
  const [newKbDesc, setNewKbDesc] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchKbList();
  }, []);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(timer);
  }, [error]);

  async function fetchKbList() {
    try {
      setLoading(true);
      const res = await fetch("/api/kb");
      if (res.ok) {
        const kbs = await res.json();
        setKbList(kbs);
        if (kbs.length > 0 && !selectedKb) {
          await fetchKbDetails(kbs[0].id);
        }
      }
    } catch (error) {
      console.error("Failed to fetch KB list:", error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchKbDetails(kbId: string) {
    try {
      const res = await fetch(`/api/kb/${kbId}`);
      if (res.ok) {
        setSelectedKb(await res.json());
      }
    } catch (error) {
      console.error("Failed to fetch KB details:", error);
    }
  }

  async function createKb() {
    if (!newKbName.trim()) return;

    try {
      const res = await fetch("/api/kb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newKbName,
          description: newKbDesc,
        }),
      });

      if (res.ok) {
        const newKb = await res.json();
        setKbList([...kbList, newKb]);
        setSelectedKb(newKb);
        setNewKbName("");
        setNewKbDesc("");
        setShowNewKbForm(false);
      } else {
        setError("Failed to create knowledge base.");
      }
    } catch (error) {
      console.error("Failed to create KB:", error);
      setError("Failed to create knowledge base.");
    }
  }

  async function deleteKb(kbId: string) {
    if (!confirm("Delete this knowledge base and all documents? This cannot be undone."))
      return;

    try {
      const res = await fetch(`/api/kb/${kbId}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Failed to delete knowledge base.");
        return;
      }
      const updated = kbList.filter((kb) => kb.id !== kbId);
      setKbList(updated);
      if (selectedKb?.id === kbId) {
        if (updated.length > 0) {
          await fetchKbDetails(updated[0].id);
        } else {
          setSelectedKb(null);
        }
      }
    } catch (error) {
      console.error("Failed to delete KB:", error);
      setError("Failed to delete knowledge base.");
    }
  }

  async function deleteDocument(kbId: string, docId: string) {
    if (!confirm("Delete this document?")) return;

    try {
      const res = await fetch(`/api/kb/${kbId}/documents/${docId}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Failed to delete document.");
        return;
      }
      if (selectedKb?.id === kbId) {
        setSelectedKb({
          ...selectedKb,
          documents: selectedKb.documents?.filter((d) => d.id !== docId),
        });
        setKbList((prev) =>
          prev.map((kb) =>
            kb.id === kbId && kb._count
              ? { ...kb, _count: { documents: kb._count.documents - 1 } }
              : kb,
          ),
        );
      }
    } catch (error) {
      console.error("Failed to delete document:", error);
      setError("Failed to delete document.");
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!selectedKb?.id || !e.target.files?.length) return;

    setUploading(true);
    const fileList = Array.from(e.target.files);

    try {
      const results = await Promise.allSettled(
        fileList.map(async (file) => {
          const formData = new FormData();
          formData.append("file", file);

          const res = await fetch(`/api/kb/${selectedKb.id}/ingest`, {
            method: "POST",
            body: formData,
          });

          if (res.ok) {
            const { document: doc } = await res.json();
            return { file, doc };
          }
          throw new Error(`Failed to upload ${file.name}`);
        }),
      );

      let succeeded = 0;
      for (const result of results) {
        if (result.status === "fulfilled") {
          const { doc } = result.value;
          succeeded++;
          setSelectedKb((prev) =>
            prev
              ? { ...prev, documents: [...(prev.documents || []), doc] }
              : prev,
          );
        } else {
          console.error("Upload failed:", result.reason);
        }
      }

      if (succeeded > 0) {
        setKbList((prev) =>
          prev.map((kb) =>
            kb.id === selectedKb.id
              ? { ...kb, _count: { documents: (kb._count?.documents || 0) + succeeded } }
              : kb,
          ),
        );
      }

      const failed = results.length - succeeded;
      if (failed > 0) {
        setError(
          failed === 1
            ? "Failed to upload 1 file."
            : `Failed to upload ${failed} files.`,
        );
      }
    } catch (error) {
      console.error("Upload error:", error);
      setError("Upload failed.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <AppShell>
        <main className="text-[var(--foreground)] p-8">
          <div className="sticky top-0 z-10 bg-[var(--background)] -mt-8 pt-8 flex items-center gap-3 mb-8">
            <SidebarToggleButton />
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold">Knowledge Base Management</h1>
          </div>

          {error && (
            <div className="mb-6 px-4 py-3 glass-card rounded-[var(--glass-radius-md)] border border-red-900/50 text-red-300 text-sm max-w-6xl">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl">
            {/* Knowledge Bases List */}
            <div className="md:col-span-1">
              <div className="glass-card rounded-[var(--glass-radius-xl)] p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold">Knowledge Bases</h2>
                  <button
                    onClick={() => setShowNewKbForm(!showNewKbForm)}
                    className="px-3 py-1 glass-button-primary text-white rounded-[var(--glass-radius-md)] text-sm font-medium"
                  >
                    New
                  </button>
                </div>

                {showNewKbForm && (
                  <div className="mb-4 space-y-2 pb-4 border-b border-[var(--glass-border)]">
                    <input
                      type="text"
                      placeholder="KB name"
                      value={newKbName}
                      onChange={(e) => setNewKbName(e.target.value)}
                      className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm"
                    />
                    <input
                      type="text"
                      placeholder="Description"
                      value={newKbDesc}
                      onChange={(e) => setNewKbDesc(e.target.value)}
                      className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={createKb}
                        className="flex-1 px-3 py-1 glass-button-primary text-white rounded-[var(--glass-radius-md)] text-sm font-medium"
                      >
                        Create
                      </button>
                      <button
                        onClick={() => setShowNewKbForm(false)}
                        className="flex-1 px-3 py-1 glass-button text-zinc-300 rounded-[var(--glass-radius-md)] text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {loading ? (
                  <p className="text-sm text-zinc-400">Loading...</p>
                ) : kbList.length === 0 ? (
                  <p className="text-sm text-zinc-400">No knowledge bases</p>
                ) : (
                  <div className="space-y-2">
                    {kbList.map((kb) => (
                      <button
                        key={kb.id}
                        onClick={() => fetchKbDetails(kb.id)}
                        className={`w-full text-left p-3 rounded-[var(--glass-radius-md)] border transition ${
                          selectedKb?.id === kb.id
                            ? "glass-button-primary text-white"
                            : "glass-button text-zinc-300"
                        }`}
                      >
                        <p className="font-medium text-sm">{kb.name}</p>
                        {kb.description && (
                          <p className="text-xs text-zinc-400 mt-1">
                            {kb.description}
                          </p>
                        )}
                        <p className="text-xs text-zinc-500 mt-2">
                          {kb._count?.documents || 0} document
                          {kb._count?.documents !== 1 ? "s" : ""}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* KB Details */}
            {selectedKb && (
              <div className="md:col-span-2">
                <div className="glass-card rounded-[var(--glass-radius-xl)] p-6">
                  <div className="flex items-start justify-between mb-6">
                    <div>
                      <h2 className="text-2xl font-bold">{selectedKb.name}</h2>
                      {selectedKb.description && (
                        <p className="text-sm text-zinc-400 mt-1">
                          {selectedKb.description}
                        </p>
                      )}
                      <p className="text-xs text-zinc-500 mt-3">
                        Created{" "}
                        {new Date(selectedKb.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={() => deleteKb(selectedKb.id)}
                      className="p-2 glass-button-danger rounded-[var(--glass-radius-md)] transition text-red-400"
                      title="Delete KB"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>

                  {/* Upload Section */}
                  <div className="mb-6 pb-6 border-b border-[var(--glass-border)]">
                    <label className="flex items-center justify-center w-full p-6 border-2 border-dashed border-[var(--glass-border)] rounded-[var(--glass-radius-lg)] cursor-pointer hover:border-[var(--glass-accent)] hover:bg-[var(--glass-bg-hover)] transition">
                      <div className="flex flex-col items-center justify-center">
                        <Upload size={32} className="text-zinc-400 mb-2" />
                        <p className="font-medium text-sm">Drop files here or click to upload</p>
                        <p className="text-xs text-zinc-400 mt-1">
                          PDF, TXT, MD, DOC, DOCX
                        </p>
                      </div>
                      <input
                        type="file"
                        multiple
                        onChange={handleFileUpload}
                        disabled={uploading}
                        accept=".pdf,.txt,.md,.doc,.docx"
                        className="hidden"
                      />
                    </label>
                  </div>

                  {/* Documents List */}
                  <div>
                    <h3 className="font-bold mb-4">
                      Documents ({selectedKb.documents?.length || 0})
                    </h3>
                    {selectedKb.documents && selectedKb.documents.length > 0 ? (
                      <div className="space-y-2">
                        {selectedKb.documents.map((doc) => (
                          <div
                            key={doc.id}
                            className="flex items-center justify-between p-3 glass-card rounded-[var(--glass-radius-md)]"
                          >
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <FileText size={18} className="text-zinc-400 shrink-0" />
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">
                                  {doc.filename}
                                </p>
                                <p className="text-xs text-zinc-400">
                                  {new Date(doc.createdAt).toLocaleDateString()}
                                </p>
                              </div>
                            </div>
                            <button
                              onClick={() => deleteDocument(selectedKb.id, doc.id)}
                              className="p-2 glass-button rounded-[var(--glass-radius-sm)] text-zinc-400 hover:text-red-400 shrink-0"
                              title="Delete document"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-zinc-400">
                        No documents yet. Upload some to get started.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
    </AppShell>
  );
}
