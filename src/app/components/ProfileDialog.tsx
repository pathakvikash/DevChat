"use client";

import { useEffect, useMemo, useState } from "react";
import {
  User,
  Settings,
  HardDrive,
  Sun,
  Moon,
  Brain,
  LogOut,
  Search,
  BookOpen,
  StickyNote,
  Cpu,
  Activity,
  X,
  ExternalLink,
  Check,
  Cable,
} from "lucide-react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useTheme } from "@/app/components/ThemeProvider";
import CenteredDialog from "@/app/components/ui/CenteredDialog";
import OllamaModelManagerDialog from "@/app/components/OllamaModelManagerDialog";
import { fetchSettings, saveSettings } from "@/app/hooks/useSettingsApi";

const MEMORY_KEY = "vas:settings:memory_enabled";

interface NavLink {
  label: string;
  icon: typeof BookOpen;
  href?: string;
  action?: "models";
}

const WORKSPACE_LINKS: NavLink[] = [
  { label: "Knowledge Base", icon: BookOpen, href: "/kb" },
  { label: "Notes", icon: StickyNote, href: "/notes" },
  { label: "Memory", icon: Brain, href: "/memory" },
  { label: "Claude System", icon: HardDrive, href: "/claude" },
];

const TOOL_LINKS: NavLink[] = [
  { label: "Manage Models", icon: Cpu, action: "models" },
  { label: "MCP Servers", icon: Cable, href: "/settings/mcp" },
  { label: "Settings", icon: Settings, href: "/settings" },
  { label: "Observability", icon: Activity, href: "/observability" },
];

const ALL_LINKS = [...WORKSPACE_LINKS, ...TOOL_LINKS];

export default function ProfileDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { theme, setTheme } = useTheme();
  const { data: session } = useSession();
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [query, setQuery] = useState("");
  const [showModelManager, setShowModelManager] = useState(false);
  const [activeSection, setActiveSection] = useState<string>("profile");
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const [instructions, setInstructions] = useState("");
  const [instructionsSaved, setInstructionsSaved] = useState(true);
  const [savingInstructions, setSavingInstructions] = useState(false);

  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) setActiveSection("profile");
  }

  useEffect(() => {
    const saved = localStorage.getItem(MEMORY_KEY);
    if (saved !== null) {
      setMemoryEnabled(saved === "true");
    }
  }, []);

  useEffect(() => {
    fetchSettings()
      .then((s) => setInstructions(s.customInstructions || ""))
      .catch(() => {});
  }, []);

  async function saveInstructions() {
    setSavingInstructions(true);
    try {
      await saveSettings({ customInstructions: instructions });
      setInstructionsSaved(true);
    } finally {
      setSavingInstructions(false);
    }
  }

  function toggleMemory() {
    const next = !memoryEnabled;
    setMemoryEnabled(next);
    localStorage.setItem(MEMORY_KEY, String(next));
  }

  const q = query.trim().toLowerCase();
  const workspaceLinks = useMemo(
    () => WORKSPACE_LINKS.filter((l) => l.label.toLowerCase().includes(q)),
    [q],
  );
  const toolLinks = useMemo(
    () => TOOL_LINKS.filter((l) => l.label.toLowerCase().includes(q)),
    [q],
  );
  const showProfileRow = "profile".includes(q);
  const activeLink = ALL_LINKS.find((l) => l.href === activeSection);

  function navRow(link: NavLink, variant: "sidebar" | "tab" = "sidebar") {
    const Icon = link.icon;
    const active = !!link.href && activeSection === link.href;
    const layoutCls =
      variant === "sidebar"
        ? "w-full text-left gap-2.5 px-2.5 py-1.5"
        : "shrink-0 gap-1.5 px-3 py-2 whitespace-nowrap";
    const className = `flex items-center rounded-[var(--glass-radius-sm)] text-sm transition ${layoutCls} ${
      active
        ? "bg-[var(--glass-bg-hover)] text-zinc-100"
        : "text-zinc-400 hover:text-zinc-200 hover:bg-[var(--glass-bg-hover)]"
    }`;
    return (
      <button
        key={link.label}
        onClick={() =>
          link.action === "models" ? setShowModelManager(true) : setActiveSection(link.href!)
        }
        className={className}
      >
        <Icon size={15} />
        {link.label}
      </button>
    );
  }

  return (
    <CenteredDialog isOpen={isOpen} onClose={onClose} widthClass="max-w-6xl" paddingClass="p-0">
      <div className="flex flex-col md:flex-row h-[85vh]">
        {/* Mobile: horizontal scrollable tab bar */}
        <div className="md:hidden border-b border-[var(--glass-border)] overflow-x-auto shrink-0">
          <div className="flex gap-1 p-2 w-max">
            {navRow({ label: "Profile", icon: User, href: "profile" }, "tab")}
            {WORKSPACE_LINKS.map((l) => navRow(l, "tab"))}
            {TOOL_LINKS.map((l) => navRow(l, "tab"))}
          </div>
        </div>

        {/* Desktop: left nav */}
        <div className="hidden md:flex md:w-60 md:shrink-0 border-r border-[var(--glass-border)] flex-col">
          <div className="p-3">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                className="w-full glass-input rounded-[var(--glass-radius-md)] pl-8 pr-2 py-1.5 text-sm"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-4">
            {showProfileRow && (
              <div className="space-y-0.5">
                <div className="px-2.5 text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">
                  Account
                </div>
                <button
                  onClick={() => setActiveSection("profile")}
                  className={`w-full text-left flex items-center gap-2.5 px-2.5 py-1.5 rounded-[var(--glass-radius-sm)] text-sm transition ${
                    activeSection === "profile"
                      ? "bg-[var(--glass-bg-hover)] text-zinc-100"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-[var(--glass-bg-hover)]"
                  }`}
                >
                  <User size={15} />
                  Profile
                </button>
              </div>
            )}
            {workspaceLinks.length > 0 && (
              <div className="space-y-0.5">
                <div className="px-2.5 text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">
                  Workspace
                </div>
                {workspaceLinks.map((l) => navRow(l))}
              </div>
            )}
            {toolLinks.length > 0 && (
              <div className="space-y-0.5">
                <div className="px-2.5 text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">
                  Tools
                </div>
                {toolLinks.map((l) => navRow(l))}
              </div>
            )}
          </div>
        </div>

        {/* Right content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-[var(--glass-border)] shrink-0">
            <h2 className="text-base sm:text-lg font-semibold text-zinc-100 truncate">
              {activeSection === "profile" ? "Profile" : activeLink?.label}
            </h2>
            <div className="flex items-center gap-2 shrink-0">
              {activeLink?.href && (
                <Link
                  href={activeLink.href}
                  onClick={onClose}
                  className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs rounded-[var(--glass-radius-md)] glass-button text-zinc-300 hover:text-zinc-100 transition"
                >
                  <ExternalLink size={13} />
                  <span className="hidden sm:inline">Open full page</span>
                </Link>
              )}
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg glass-button text-zinc-400 hover:text-zinc-100 transition"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {activeSection === "profile" ? (
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
              <div className="flex flex-wrap items-center gap-4">
                {session?.user?.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={session.user.image} alt="" className="size-16 rounded-full shrink-0" />
                ) : (
                  <div className="size-16 rounded-full glass-surface flex items-center justify-center shrink-0">
                    <User size={32} className="text-zinc-400" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="text-xl font-semibold text-zinc-200 truncate">
                    {session?.user?.name || "Signed in"}
                  </h3>
                  <p className="text-sm text-zinc-500 truncate">{session?.user?.email}</p>
                </div>
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="flex items-center gap-2 px-3 py-2 rounded-[var(--glass-radius-md)] glass-button text-sm text-zinc-300 hover:text-zinc-100 transition shrink-0"
                >
                  <LogOut size={15} />
                  Sign out
                </button>
              </div>

              <div className="glass-card rounded-[var(--glass-radius-xl)] p-5">
                <h3 className="text-sm font-bold mb-1">Instructions for DevChat</h3>
                <p className="text-xs text-zinc-500 mb-3">
                  Always included as part of the system prompt, on top of any
                  per-conversation instructions.
                </p>
                <textarea
                  value={instructions}
                  onChange={(e) => {
                    setInstructions(e.target.value);
                    setInstructionsSaved(false);
                  }}
                  onBlur={() => {
                    if (!instructionsSaved) saveInstructions();
                  }}
                  placeholder="e.g. Keep answers concise. Prefer TypeScript. Explain tradeoffs before recommending one."
                  rows={4}
                  className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 text-sm resize-y"
                />
                <div className="flex items-center justify-end gap-2 mt-2 h-4">
                  {savingInstructions ? (
                    <span className="text-xs text-zinc-500">Saving...</span>
                  ) : instructionsSaved ? (
                    <span className="flex items-center gap-1 text-xs text-zinc-500">
                      <Check size={12} />
                      Saved
                    </span>
                  ) : (
                    <button
                      onClick={saveInstructions}
                      className="text-xs text-blue-400 hover:text-blue-300 transition"
                    >
                      Save
                    </button>
                  )}
                </div>
              </div>

              <div className="glass-card rounded-[var(--glass-radius-xl)] p-5">
                <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
                  <Sun size={16} className="text-zinc-400" />
                  Theme
                </h3>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setTheme("dark")}
                    className={`flex items-center gap-2 px-4 py-2 rounded-[var(--glass-radius-md)] text-sm font-medium transition ${
                      theme === "dark"
                        ? "glass-button-primary text-white"
                        : "glass-button text-zinc-300"
                    }`}
                  >
                    <Moon size={16} />
                    Dark
                  </button>
                  <button
                    onClick={() => setTheme("light")}
                    className={`flex items-center gap-2 px-4 py-2 rounded-[var(--glass-radius-md)] text-sm font-medium transition ${
                      theme === "light"
                        ? "glass-button-primary text-white"
                        : "glass-button text-zinc-300"
                    }`}
                  >
                    <Sun size={16} />
                    Light
                  </button>
                </div>
              </div>

              <div className="glass-card rounded-[var(--glass-radius-xl)] p-5">
                <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
                  <Brain size={16} className="text-zinc-400" />
                  Memory
                </h3>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-zinc-200">
                      {memoryEnabled ? "Memory enabled" : "Memory disabled"}
                    </p>
                    <p className="text-xs text-zinc-500 mt-1">
                      Default memory state for new conversations
                    </p>
                  </div>
                  <button
                    onClick={toggleMemory}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      memoryEnabled ? "bg-blue-600" : "bg-zinc-700"
                    }`}
                  >
                    <span
                      className={`inline-block size-5 rounded-full bg-white transition-transform ${
                        memoryEnabled ? "translate-x-[22px]" : "translate-x-[2px]"
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <iframe
              key={activeSection}
              src={`${activeSection}?embed=1`}
              title={activeLink?.label}
              className="flex-1 w-full border-0"
            />
          )}
        </div>
      </div>

      <OllamaModelManagerDialog
        isOpen={showModelManager}
        onClose={() => setShowModelManager(false)}
      />
    </CenteredDialog>
  );
}
