"use client";

import { useEffect, useState, useCallback, useMemo, useRef, useId } from "react";
import {
  FileCode,
  FileText,
  FileSpreadsheet,
  FileJson,
  Image,
  GitBranch,
  Globe,
  Trash2,
  Pencil,
  X,
  Check,
  Loader2,
  ExternalLink,
  Square,
  AlertTriangle,
  Maximize2,
  ArrowLeft,
} from "lucide-react";
import CenteredDialog from "./ui/CenteredDialog";
import SidePanel from "./ui/SidePanel";
import { resolveLanguage, highlightCode } from "@/lib/utils/highlight";
import CodeRunner from "./CodeRunner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Artifact {
  id: string;
  type: "code" | "document" | "report" | "table" | "svg" | "mermaid" | "html";
  title: string;
  content: string;
  version: number;
  language?: string;
  createdAt: string;
  updatedAt: string;
}

interface ArtifactPanelProps {
  conversationId: string;
  isOpen: boolean;
  onClose: () => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const TYPE_BADGE: Record<string, { label: string; bg: string; text: string; border: string }> = {
  code: { label: "Code", bg: "bg-blue-500/20", text: "text-blue-300", border: "border-blue-500/30" },
  document: { label: "Doc", bg: "bg-green-500/20", text: "text-green-300", border: "border-green-500/30" },
  report: { label: "Report", bg: "bg-amber-500/20", text: "text-amber-300", border: "border-amber-500/30" },
  table: { label: "Table", bg: "bg-purple-500/20", text: "text-purple-300", border: "border-purple-500/30" },
  svg: { label: "SVG", bg: "bg-cyan-500/20", text: "text-cyan-300", border: "border-cyan-500/30" },
  mermaid: { label: "Mermaid", bg: "bg-pink-500/20", text: "text-pink-300", border: "border-pink-500/30" },
  html: { label: "HTML", bg: "bg-orange-500/20", text: "text-orange-300", border: "border-orange-500/30" },
};

const TYPE_ICONS: Record<string, typeof FileCode> = {
  code: FileCode,
  document: FileText,
  report: FileSpreadsheet,
  table: FileJson,
  svg: Image,
  mermaid: GitBranch,
  html: Globe,
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function ArtifactPanel({
  conversationId,
  isOpen,
  onClose,
  selectedId,
  onSelect,
}: ArtifactPanelProps) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openPreviewIds, setOpenPreviewIds] = useState<Set<string>>(new Set());
  const previewWindows = useRef<Map<string, Window | null>>(new Map());
  const [viewModes, setViewModes] = useState<Record<string, "preview" | "code">>({});

  const openPreview = useCallback((artifactId: string) => {
    const url = `/api/conversations/${conversationId}/artifacts/${artifactId}/html`;
    const win = window.open(url, `html-preview-${artifactId}`, "width=1200,height=800");
    if (win) {
      previewWindows.current.set(artifactId, win);
      setOpenPreviewIds(prev => new Set(prev).add(artifactId));
    }
  }, [conversationId]);

  const closePreview = useCallback((artifactId: string) => {
    const win = previewWindows.current.get(artifactId);
    if (win && !win.closed) {
      win.close();
    }
    previewWindows.current.delete(artifactId);
    setOpenPreviewIds(prev => {
      const next = new Set(prev);
      next.delete(artifactId);
      return next;
    });
  }, []);

  useEffect(() => {
    const windows = previewWindows.current;
    return () => {
      for (const win of windows.values()) {
        if (win && !win.closed) win.close();
      }
      windows.clear();
    };
  }, []);

  const handleSelect = useCallback((id: string | null) => {
    onSelect(id);
    if (id) {
      const a = artifacts.find((x) => x.id === id);
      if (a?.type === "html" && !openPreviewIds.has(id)) {
        openPreview(id);
      }
    }
  }, [onSelect, artifacts, openPreviewIds, openPreview]);

  const selectedArtifact = useMemo(
    () => artifacts.find((a) => a.id === selectedId) || null,
    [artifacts, selectedId],
  );

  const fetchArtifacts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/artifacts`);
      if (res.ok) {
        const data = await res.json();
        setArtifacts(data.artifacts);
      }
    } catch (e) {
      console.error("Failed to fetch artifacts:", e);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    if (isOpen) fetchArtifacts();
  }, [isOpen, fetchArtifacts]);

  useEffect(() => {
    if (isOpen && selectedId) fetchArtifacts();
  }, [selectedId]);

  async function handleDelete(artifactId: string) {
    try {
      const res = await fetch(
        `/api/conversations/${conversationId}/artifacts/${artifactId}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        setArtifacts((prev) => prev.filter((a) => a.id !== artifactId));
        if (selectedId === artifactId) onSelect(null);
      }
    } catch (e) {
      console.error("Failed to delete artifact:", e);
    }
    setDeletingId(null);
  }

  async function handleSaveEdit(artifactId: string) {
    try {
      const res = await fetch(
        `/api/conversations/${conversationId}/artifacts/${artifactId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: editContent }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        setArtifacts((prev) =>
          prev.map((a) =>
            a.id === artifactId ? { ...a, content: data.artifact.content, version: data.artifact.version, updatedAt: data.artifact.updatedAt } : a,
          ),
        );
      }
    } catch (e) {
      console.error("Failed to update artifact:", e);
    }
    setEditingId(null);
  }

  function ViewModeTabs({ artifactId }: { artifactId: string }) {
    const mode = viewModes[artifactId] || "preview";
    return (
      <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg glass-card w-fit">
        {(["preview", "code"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setViewModes((prev) => ({ ...prev, [artifactId]: m }))}
            className={`px-2.5 py-1 text-xs rounded-md capitalize transition ${
              mode === m
                ? "bg-[var(--glass-bg-hover)] text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {m}
          </button>
        ))}
      </div>
    );
  }

  function renderContent(artifact: Artifact) {
    if (editingId === artifact.id) {
      return (
        <div className="space-y-3">
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full min-h-[30vh] glass-input rounded-[var(--glass-radius-md)] px-4 py-3 text-sm font-mono resize-y"
            spellCheck={false}
          />
          <div className="flex gap-2">
            <button
              onClick={() => handleSaveEdit(artifact.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white transition"
            >
              <Check size={14} />
              Save
            </button>
            <button
              onClick={() => setEditingId(null)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded glass-button text-zinc-300 transition"
            >
              <X size={14} />
              Cancel
            </button>
          </div>
        </div>
      );
    }

    if (deletingId === artifact.id) {
      return (
        <div className="space-y-3 p-4 rounded-[var(--glass-radius-md)] border border-red-900 bg-red-950/30">
          <p className="text-sm text-red-200">Delete this artifact?</p>
          <div className="flex gap-2">
            <button
              onClick={() => handleDelete(artifact.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-red-600 hover:bg-red-500 text-white transition"
            >
              <Trash2 size={14} />
              Delete
            </button>
            <button
              onClick={() => setDeletingId(null)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded glass-button text-zinc-300 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }

    if (artifact.type === "code") {
      const lang = resolveLanguage(artifact.language || "");
      const html = highlightCode(artifact.content, artifact.language || "");
      return (
        <div>
          <pre className="overflow-x-auto rounded-[var(--glass-radius-md)] glass-card">
            <code
              className={lang ? `language-${lang}` : undefined}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </pre>
          <CodeRunner code={artifact.content} language={artifact.language || ""} />
        </div>
      );
    }

    if (artifact.type === "document" || artifact.type === "report") {
      return (
        <div className="prose prose-invert prose-sm max-w-none glass-card rounded-[var(--glass-radius-md)] px-4 py-3">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {artifact.content}
          </ReactMarkdown>
        </div>
      );
    }

    if (artifact.type === "html") {
      const isOpen = openPreviewIds.has(artifact.id);
      const htmlUrl = `/api/conversations/${conversationId}/artifacts/${artifact.id}/html`;
      const mode = viewModes[artifact.id] || "preview";
      return (
        <div className="space-y-3">
          <ViewModeTabs artifactId={artifact.id} />
          {mode === "preview" ? (
            <>
              <div className="rounded-[var(--glass-radius-md)] overflow-hidden border border-[var(--glass-border)] bg-white" style={{ minHeight: "200px" }}>
                <iframe
                  src={htmlUrl}
                  title={artifact.title}
                  className="w-full border-0"
                  style={{ height: "50vh", minHeight: "250px" }}
                  sandbox="allow-scripts allow-same-origin"
                />
              </div>
              <div className="flex gap-2 items-center flex-wrap">
                <a
                  href={htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-orange-600 hover:bg-orange-500 text-white transition"
                >
                  <ExternalLink size={14} />
                  Open in new tab
                </a>
                {isOpen && (
                  <button
                    onClick={() => closePreview(artifact.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-red-600 hover:bg-red-500 text-white transition"
                  >
                    <Square size={14} />
                    Close tab
                  </button>
                )}
              </div>
            </>
          ) : (
            <pre className="overflow-x-auto rounded-[var(--glass-radius-md)] glass-card px-4 py-3 text-sm text-zinc-200 font-mono whitespace-pre-wrap break-all">
              <code
                dangerouslySetInnerHTML={{ __html: highlightCode(artifact.content, "html") }}
              />
            </pre>
          )}
        </div>
      );
    }

    if (artifact.type === "svg") {
      const mode = viewModes[artifact.id] || "preview";
      return (
        <div className="space-y-3">
          <ViewModeTabs artifactId={artifact.id} />
          {mode === "preview" ? (
            <div
              className="rounded-[var(--glass-radius-md)] overflow-auto border border-[var(--glass-border)] bg-white flex items-center justify-center p-4"
              style={{ minHeight: "200px" }}
              dangerouslySetInnerHTML={{ __html: artifact.content }}
            />
          ) : (
            <pre className="overflow-x-auto rounded-[var(--glass-radius-md)] glass-card px-4 py-3 text-sm text-zinc-200 font-mono whitespace-pre-wrap break-all">
              {artifact.content}
            </pre>
          )}
        </div>
      );
    }

    if (artifact.type === "mermaid") {
      const mode = viewModes[artifact.id] || "preview";
      return (
        <div className="space-y-3">
          <ViewModeTabs artifactId={artifact.id} />
          {mode === "preview" ? (
            <MermaidRenderer content={artifact.content} />
          ) : (
            <pre className="overflow-x-auto rounded-[var(--glass-radius-md)] glass-card px-4 py-3 text-sm text-zinc-200 font-mono whitespace-pre-wrap break-all">
              {artifact.content}
            </pre>
          )}
        </div>
      );
    }

    return (
      <pre className="overflow-x-auto rounded-[var(--glass-radius-md)] glass-card px-4 py-3 text-sm text-zinc-200 font-mono whitespace-pre-wrap break-all">
        {artifact.content}
      </pre>
    );
  }

  const subtitle = selectedArtifact
    ? `${selectedArtifact.title} — v${selectedArtifact.version}`
    : undefined;

  return (
    <SidePanel
      isOpen={isOpen}
      onClose={onClose}
      title="Artifacts"
      subtitle={subtitle}
      widthClass="max-w-2xl"
    >
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-zinc-500" />
        </div>
      )}

      {!loading && artifacts.length === 0 && (
        <div className="text-center py-12 text-zinc-500 text-sm">
          No artifacts yet. Ask the AI to create one.
        </div>
      )}

      {!loading && artifacts.length > 0 && !selectedArtifact && (
        <div className="space-y-2">
          {artifacts.map((artifact) => {
            const Icon = TYPE_ICONS[artifact.type] || FileText;
            const badge = TYPE_BADGE[artifact.type] || TYPE_BADGE.document;
            return (
              <button
                key={artifact.id}
                onClick={() => handleSelect(artifact.id)}
                className="w-full flex items-center gap-3 glass-card rounded-[var(--glass-radius-md)] px-4 py-3 hover:bg-[var(--glass-bg-hover)] transition text-left"
              >
                <Icon size={18} className={badge.text} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-zinc-200 truncate">
                    {artifact.title}
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {timeAgo(artifact.updatedAt)}
                  </div>
                </div>
                <span
                  className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded shrink-0 ${badge.bg} ${badge.text} ${badge.border} border`}
                >
                  {badge.label}
                </span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded glass text-zinc-500 shrink-0">
                  v{artifact.version}
                </span>
                {openPreviewIds.has(artifact.id) && (
                  <span className="size-1.5 rounded-full bg-orange-400 shrink-0" title="Preview open" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {!loading && selectedArtifact && (
        <div className="space-y-4">
          <button
            onClick={() => onSelect(null)}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition"
          >
            <ArrowLeft size={14} />
            Back to artifacts
          </button>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
               {(() => {
                 const badge = TYPE_BADGE[selectedArtifact.type] || TYPE_BADGE.document;
                 return (
                   <span
                    className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded ${badge.bg} ${badge.text} ${badge.border} border`}
                  >
                    {badge.label}
                  </span>
                );
              })()}
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded glass text-zinc-500">
                v{selectedArtifact.version}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {editingId !== selectedArtifact.id && (
                <button
                  onClick={() => {
                    setEditContent(selectedArtifact.content);
                    setEditingId(selectedArtifact.id);
                  }}
                  className="p-1.5 rounded glass-button text-zinc-400 transition"
                  title="Edit"
                >
                  <Pencil size={14} />
                </button>
              )}
              {deletingId !== selectedArtifact.id && (
                <button
                  onClick={() => setDeletingId(selectedArtifact.id)}
                  className="p-1.5 rounded glass-button text-zinc-400 transition"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>

          <p className="text-xs text-zinc-500">
            Updated {timeAgo(selectedArtifact.updatedAt)}
          </p>

          {renderContent(selectedArtifact)}

          {openPreviewIds.size > 0 && (
            <div className="space-y-2 pt-2 border-t border-[var(--glass-border)]">
              <p className="text-xs text-zinc-500 font-medium">Active previews</p>
              <div className="space-y-1">
                {Array.from(openPreviewIds).map((id) => {
                  const a = artifacts.find((x) => x.id === id);
                  return (
                    <div
                      key={id}
                      className="flex items-center justify-between glass-card rounded-[var(--glass-radius-md)] px-3 py-2"
                    >
                      <span className="text-xs text-zinc-300 truncate min-w-0">
                        {a?.title || id}
                      </span>
                      <button
                        onClick={() => closePreview(id)}
                        className="shrink-0 p-1 rounded hover:bg-white/10 text-zinc-500 hover:text-red-400 transition"
                        title="Close preview"
                      >
                        <Square size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </SidePanel>
  );
}

function MermaidRenderer({ content }: { content: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const renderId = `mermaid-artifact-${useId().replace(/:/g, "")}`;

  useEffect(() => {
    let cancelled = false;
    async function render() {
      try {
        const mermaid = await import("mermaid");
        mermaid.default.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "loose",
        });
        const { svg } = await mermaid.default.render(
          `${renderId}-${Date.now()}`,
          content,
        );
        if (!cancelled) setSvg(svg);
      } catch (e) {
        console.error("Mermaid render failed", e);
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setSvg(null);
        }
      }
    }
    render();
    return () => { cancelled = true; };
  }, [content]);

  if (svg) {
    return (
      <>
        <div className="relative">
          <div
            className="rounded-[var(--glass-radius-md)] overflow-auto border border-[var(--glass-border)] bg-white flex items-center justify-center p-4"
            style={{ minHeight: "200px" }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <button
            onClick={() => setFullscreen(true)}
            title="View fullscreen"
            className="absolute top-2 right-2 p-1.5 rounded bg-black/60 hover:bg-black/80 text-white transition"
          >
            <Maximize2 size={14} />
          </button>
        </div>
        <CenteredDialog
          isOpen={fullscreen}
          onClose={() => setFullscreen(false)}
          widthClass="max-w-[95vw]"
          paddingClass="p-4"
        >
          <div className="flex justify-end mb-2">
            <button
              onClick={() => setFullscreen(false)}
              className="p-1.5 rounded hover:bg-white/10 text-zinc-300 transition"
            >
              <X size={18} />
            </button>
          </div>
          <div
            className="rounded-[var(--glass-radius-md)] overflow-auto bg-white flex items-center justify-center p-4"
            style={{ maxHeight: "85vh" }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </CenteredDialog>
      </>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs text-red-400">
          <AlertTriangle size={14} />
          Mermaid render failed{error ? `: ${error}` : ""}
        </div>
        <pre className="overflow-x-auto rounded-[var(--glass-radius-md)] glass-card px-4 py-3 text-sm text-zinc-200 font-mono whitespace-pre-wrap break-all">
          {content}
        </pre>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center py-8">
      <Loader2 size={20} className="animate-spin text-zinc-500" />
    </div>
  );
}
