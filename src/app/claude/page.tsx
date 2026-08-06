"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { FolderOpen, ListChecks, FileText, Settings, ChevronDown, ChevronRight, HardDrive, X, Save, Eye, Edit3, Loader2, Globe, Lightbulb, ClipboardList, Brain } from "lucide-react";
import AppShell, { SidebarToggleButton } from "@/app/components/AppShell";
import ClaudeRunner from "@/app/components/claude/ClaudeRunner";

interface FileEntry {
  name: string;
  path: string;
  size: number;
  modified: string;
  content: string;
  type: "md" | "html" | "json" | "jsonl" | "other";
}

interface Project {
  name: string;
  files: FileEntry[];
}

interface TaskStep {
  id: string;
  subject: string;
  status: string;
  activeForm: string;
}

interface Task {
  id: string;
  path: string;
  steps: TaskStep[];
}

interface ClaudeSystemData {
  settings: Record<string, unknown>;
  artifacts: FileEntry[];
  plans: FileEntry[];
  skills: FileEntry[];
  projects: Project[];
  tasks: Task[];
}

interface FileModalState {
  open: boolean;
  path: string;
  name: string;
  content: string;
  fullContent: string | null;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  mode: "view" | "edit";
  error: string | null;
  type: "memory" | "html" | "json" | "other";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function SectionCard({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="glass-card rounded-[var(--glass-radius-xl)] p-6">
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        <Icon size={20} className="text-zinc-400" />
        {title}
      </h2>
      {children}
    </div>
  );
}

function CollapsibleSection({ title, count, defaultOpen = false, children }: { title: string; count: number; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-[var(--glass-border)] rounded-[var(--glass-radius-md)] overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 glass-surface text-sm font-medium text-zinc-300 hover:text-[var(--foreground)] transition"
      >
        <span>{title} ({count})</span>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {open && <div className="divide-y divide-[var(--glass-border)]">{children}</div>}
    </div>
  );
}

function FileRow({ file, onOpen }: { file: FileEntry; onOpen: (f: FileEntry) => void }) {
  const Icon = file.type === "html" ? Globe : file.type === "json" || file.type === "jsonl" ? ClipboardList : FileText;
  const iconColor = file.type === "html" ? "text-orange-500" : file.type === "json" ? "text-purple-400" : "text-zinc-500";
  return (
    <button
      onClick={() => onOpen(file)}
      className="w-full px-4 py-3 text-sm hover:bg-[var(--glass-bg-hover)] transition text-left"
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <Icon size={14} className={`${iconColor} shrink-0`} />
          <span className="truncate font-medium text-zinc-200">{file.name}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <Eye size={12} className="text-zinc-500" />
          <span className="text-xs text-zinc-500">{formatBytes(file.size)}</span>
        </div>
      </div>
      <pre className="text-xs text-zinc-500 mt-1 line-clamp-2 whitespace-pre-wrap text-left font-sans">
        {file.content || "(empty)"}
      </pre>
    </button>
  );
}

export default function ClaudePage() {
  const embed = useSearchParams().get("embed") === "1";
  const [data, setData] = useState<ClaudeSystemData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<FileModalState>({
    open: false, path: "", name: "", content: "", fullContent: null,
    loading: false, saving: false, dirty: false, mode: "view",
    error: null, type: "other",
  });

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch("/api/claude-system");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setData(await res.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const openFile = useCallback(async (file: FileEntry) => {
    const type = file.type === "html" ? "html" : file.type === "json" || file.type === "jsonl" ? "json" : "memory";
    setModal({
      open: true, path: file.path, name: file.name, content: "", fullContent: null,
      loading: true, saving: false, dirty: false, mode: "view",
      error: null, type,
    });
    try {
      const res = await fetch("/api/claude-system/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: file.path }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setModal((prev) => ({
        ...prev,
        loading: false,
        fullContent: data.content,
        content: data.content,
      }));
    } catch (e) {
      setModal((prev) => ({
        ...prev,
        loading: false,
        error: e instanceof Error ? e.message : "Failed to load file",
      }));
    }
  }, []);

  const closeModal = useCallback(() => {
    setModal((prev) => ({ ...prev, open: false }));
  }, []);

  const toggleMode = useCallback(() => {
    setModal((prev) => ({ ...prev, mode: prev.mode === "view" ? "edit" : "view", dirty: false }));
  }, []);

  const handleContentChange = useCallback((newContent: string) => {
    setModal((prev) => ({ ...prev, content: newContent, dirty: true }));
  }, []);

  const saveFile = useCallback(async () => {
    setModal((prev) => ({ ...prev, saving: true, error: null }));
    try {
      const res = await fetch("/api/claude-system/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: modal.path, content: modal.content }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setModal((prev) => ({ ...prev, saving: false, dirty: false, fullContent: modal.content, mode: "view" }));
    } catch (e) {
      setModal((prev) => ({
        ...prev,
        saving: false,
        error: e instanceof Error ? e.message : "Failed to save",
      }));
    }
  }, [modal.path, modal.content]);

  if (loading) {
    const loadingContent = (
          <main className="text-[var(--foreground)] p-8">
            <div className="max-w-5xl mx-auto space-y-8">Loading...</div>
          </main>
    );
    return embed ? loadingContent : <AppShell>{loadingContent}</AppShell>;
  }

  if (error) {
    const errorContent = (
          <main className="text-[var(--foreground)] p-8">
            <div className="max-w-5xl mx-auto">
              <div className="glass-card rounded-[var(--glass-radius-xl)] p-6 border-red-900/60">
                <p className="text-red-400">Failed to load: {error}</p>
              </div>
            </div>
          </main>
    );
    return embed ? errorContent : <AppShell>{errorContent}</AppShell>;
  }

  if (!data) return null;

  const totalArtifacts = data.artifacts.length;
  const totalPlans = data.plans.length;
  const totalSkills = data.skills.length;
  const totalTasks = data.tasks.length;
  const totalProjectFiles = data.projects.reduce((s, p) => s + p.files.length, 0);

  function renderFileList(files: FileEntry[]) {
    if (files.length === 0) return <p className="text-sm text-zinc-500 px-1">None</p>;
    return files.map((f) => <FileRow key={f.path} file={f} onOpen={openFile} />);
  }

  const content = (
      <>
        <main className="text-[var(--foreground)] p-8">
          <div className="max-w-5xl mx-auto space-y-8">
            <div className="sticky top-0 z-10 bg-[var(--background)] -mt-8 pt-8 flex items-center gap-3 mb-2">
              {!embed && <SidebarToggleButton />}
              <HardDrive size={28} className="text-zinc-400 shrink-0" />
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold">Claude Code System</h1>
            </div>

            <ClaudeRunner />

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="glass-card rounded-[var(--glass-radius-xl)] p-5">
                <div className="text-zinc-400 text-sm flex items-center gap-2"><Globe size={14} /> Artifacts</div>
                <div className="text-2xl font-bold mt-1">{totalArtifacts}</div>
              </div>
              <div className="glass-card rounded-[var(--glass-radius-xl)] p-5">
                <div className="text-zinc-400 text-sm flex items-center gap-2"><Lightbulb size={14} /> Plans</div>
                <div className="text-2xl font-bold mt-1">{totalPlans}</div>
              </div>
              <div className="glass-card rounded-[var(--glass-radius-xl)] p-5">
                <div className="text-zinc-400 text-sm flex items-center gap-2"><Brain size={14} /> Skills</div>
                <div className="text-2xl font-bold mt-1">{totalSkills}</div>
              </div>
              <div className="glass-card rounded-[var(--glass-radius-xl)] p-5">
                <div className="text-zinc-400 text-sm flex items-center gap-2"><ListChecks size={14} /> Tasks</div>
                <div className="text-2xl font-bold mt-1">{totalTasks}</div>
              </div>
              <div className="glass-card rounded-[var(--glass-radius-xl)] p-5">
                <div className="text-zinc-400 text-sm flex items-center gap-2"><FolderOpen size={14} /> Project Files</div>
                <div className="text-2xl font-bold mt-1">{totalProjectFiles}</div>
              </div>
            </div>

            {/* Artifacts */}
            <SectionCard title="Artifacts" icon={Globe}>
              <div className="divide-y divide-[var(--glass-border)]">{renderFileList(data.artifacts)}</div>
            </SectionCard>

            {/* Plans */}
            <SectionCard title="Plans" icon={Lightbulb}>
              <div className="divide-y divide-[var(--glass-border)]">{renderFileList(data.plans)}</div>
            </SectionCard>

            {/* Skills */}
            <SectionCard title="Skills" icon={Brain}>
              <div className="divide-y divide-[var(--glass-border)]">{renderFileList(data.skills)}</div>
            </SectionCard>

            {/* Tasks */}
            <SectionCard title="Tasks" icon={ListChecks}>
              <div className="space-y-2">
                {data.tasks.map((task) => (
                  <CollapsibleSection key={task.id} title={`${task.id.slice(0, 12)}...`} count={task.steps.length}>
                    {task.steps.map((step) => (
                      <div key={step.id} className="px-4 py-3 flex items-start gap-3 text-sm hover:bg-[var(--glass-bg-hover)] transition text-left">
                        <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${step.status === "completed" ? "bg-green-500" : "bg-amber-500"}`} />
                        <div className="min-w-0">
                          <div className="text-zinc-200 font-medium">{step.subject}</div>
                          <div className="text-xs text-zinc-500 flex gap-3 mt-0.5">
                            <span className="capitalize">{step.status}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </CollapsibleSection>
                ))}
                {data.tasks.length === 0 && <p className="text-sm text-zinc-500">None</p>}
              </div>
            </SectionCard>

            {/* Project Files */}
            <SectionCard title="Project Files" icon={FolderOpen}>
              <div className="space-y-3">
                {data.projects.map((proj) => (
                  <CollapsibleSection key={proj.name} title={proj.name.replace(/^-+/g, "").replace(/-/g, "/")} count={proj.files.length} defaultOpen>
                    {renderFileList(proj.files)}
                  </CollapsibleSection>
                ))}
                {data.projects.length === 0 && <p className="text-sm text-zinc-500">No project files</p>}
              </div>
            </SectionCard>

            {/* Settings */}
            <SectionCard title="Settings" icon={Settings}>
              <pre className="text-xs text-zinc-300 bg-black/30 rounded-[var(--glass-radius-md)] p-4 overflow-x-auto max-h-64">
                {JSON.stringify(data.settings, null, 2)}
              </pre>
            </SectionCard>
          </div>
        </main>

      {/* File Modal */}
      {modal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-3xl max-h-[85vh] glass-panel-strong rounded-[var(--glass-radius-xl)] border border-[var(--glass-border)] shadow-2xl flex flex-col mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--glass-border)] shrink-0">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-zinc-200 truncate">{modal.name}</h3>
                <p className="text-xs text-zinc-500 truncate mt-0.5">{modal.path}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-4">
                {(modal.type === "memory" || modal.type === "html" || modal.type === "json") && !modal.loading && modal.fullContent !== null && (
                  modal.mode === "view" ? (
                    <button onClick={toggleMode} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded glass-button text-zinc-300 hover:text-zinc-100 transition">
                      <Edit3 size={12} /> Edit
                    </button>
                  ) : (
                    <button onClick={saveFile} disabled={modal.saving || !modal.dirty} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:opacity-50 text-white transition">
                      {modal.saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save
                    </button>
                  )
                )}
                <button onClick={closeModal} className="p-1.5 rounded glass-button text-zinc-400 hover:text-zinc-200 transition">
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {modal.loading && <div className="flex items-center justify-center py-12"><Loader2 size={24} className="animate-spin text-zinc-500" /></div>}
              {modal.error && <div className="text-sm text-red-400 p-4 glass-card rounded-[var(--glass-radius-md)]">{modal.error}</div>}
              {!modal.loading && !modal.error && modal.fullContent !== null && (
                modal.type === "html" && modal.mode === "view" ? (
                  <div className="rounded-[var(--glass-radius-md)] overflow-hidden border border-[var(--glass-border)] bg-white">
                    <iframe srcDoc={modal.fullContent} className="w-full border-0" style={{ height: "60vh", minHeight: "300px" }} sandbox="allow-scripts" title={modal.name} />
                  </div>
                ) : modal.mode === "view" ? (
                  <pre className="text-sm text-zinc-200 font-mono whitespace-pre-wrap break-all leading-relaxed">{modal.fullContent}</pre>
                ) : (
                  <textarea value={modal.content} onChange={(e) => handleContentChange(e.target.value)} className="w-full min-h-[50vh] glass-input rounded-[var(--glass-radius-md)] px-4 py-3 text-sm font-mono resize-y" spellCheck={false} />
                )
              )}
              {!modal.loading && !modal.error && modal.fullContent === null && <p className="text-sm text-zinc-500">No content</p>}
            </div>
          </div>
        </div>
      )}
      </>
  );

  return embed ? content : <AppShell>{content}</AppShell>;
}
