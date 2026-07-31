"use client";

import { useEffect, useState } from "react";
import { User, Settings, HardDrive, ChevronRight, Sun, Moon, Brain, LogOut } from "lucide-react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import AppShell, { SidebarToggleButton } from "@/app/components/AppShell";
import { useTheme } from "@/app/components/ThemeProvider";

const MEMORY_KEY = "vas:settings:memory_enabled";

export default function ProfilePage() {
  const { theme, setTheme } = useTheme();
  const { data: session } = useSession();
  const [memoryEnabled, setMemoryEnabled] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem(MEMORY_KEY);
    if (saved !== null) {
      setMemoryEnabled(saved === "true");
    }
  }, []);

  function toggleMemory() {
    const next = !memoryEnabled;
    setMemoryEnabled(next);
    localStorage.setItem(MEMORY_KEY, String(next));
  }

  return (
    <AppShell>
        <main className="text-[var(--foreground)] p-8">
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="sticky top-0 z-10 bg-[var(--background)] -mt-8 pt-8 flex items-center gap-3 mb-2">
              <SidebarToggleButton />
              <User size={28} className="text-zinc-400 shrink-0" />
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold">Profile</h1>
            </div>

            <div className="glass-card rounded-[var(--glass-radius-xl)] p-6 space-y-4">
              <div className="flex items-center gap-4">
                {session?.user?.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={session.user.image}
                    alt=""
                    className="size-16 rounded-full"
                  />
                ) : (
                  <div className="size-16 rounded-full glass-surface flex items-center justify-center">
                    <User size={32} className="text-zinc-400" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-semibold text-zinc-200">
                    {session?.user?.name || "Signed in"}
                  </h2>
                  <p className="text-sm text-zinc-500">{session?.user?.email}</p>
                </div>
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="flex items-center gap-2 px-3 py-2 rounded-[var(--glass-radius-md)] glass-button text-sm text-zinc-300 hover:text-zinc-100 transition shrink-0"
                >
                  <LogOut size={15} />
                  Sign out
                </button>
              </div>
            </div>

            {/* Theme */}
            <div className="glass-card rounded-[var(--glass-radius-xl)] p-6">
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                <Sun size={18} className="text-zinc-400" />
                Theme
              </h2>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setTheme("dark")}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-[var(--glass-radius-md)] text-sm font-medium transition ${
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
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-[var(--glass-radius-md)] text-sm font-medium transition ${
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

            {/* Memory */}
            <div className="glass-card rounded-[var(--glass-radius-xl)] p-6">
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                <Brain size={18} className="text-zinc-400" />
                Memory
              </h2>
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

            {/* Links */}
            <div className="space-y-2 pt-2">
              <Link
                href="/settings"
                className="flex items-center gap-3 glass-card rounded-[var(--glass-radius-md)] px-4 py-3 hover:bg-[var(--glass-bg-hover)] transition"
              >
                <Settings size={18} className="text-zinc-400" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-zinc-200">Settings</div>
                  <div className="text-xs text-zinc-500">API keys, default model, and more</div>
                </div>
                <ChevronRight size={16} className="text-zinc-600" />
              </Link>
              <Link
                href="/claude"
                className="flex items-center gap-3 glass-card rounded-[var(--glass-radius-md)] px-4 py-3 hover:bg-[var(--glass-bg-hover)] transition"
              >
                <HardDrive size={18} className="text-zinc-400" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-zinc-200">Claude Code System</div>
                  <div className="text-xs text-zinc-500">Browse projects, sessions, and memory files</div>
                </div>
                <ChevronRight size={16} className="text-zinc-600" />
              </Link>
            </div>
          </div>
        </main>
    </AppShell>
  );
}
