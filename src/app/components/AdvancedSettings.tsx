"use client";

import { useMemo } from "react";
import { Sparkles, Wrench, Loader2 } from "lucide-react";
import SidePanel from "./ui/SidePanel";
import { useResource } from "@/app/hooks/useResource";

interface ToolInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  enabledByDefault: boolean;
  builtIn: boolean;
  serverSide: boolean;
}
interface SkillInfo {
  id: string;
  name: string;
  description: string;
  toolIds: string[];
}

interface RegistryData {
  tools: ToolInfo[];
  skills: SkillInfo[];
}

interface AdvancedSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  enabledTools: string[];
  enabledSkills: string[];
  onChange: (next: { enabledTools: string[]; enabledSkills: string[] }) => void;
}

export default function AdvancedSettings({
  isOpen,
  onClose,
  enabledTools,
  enabledSkills,
  onChange,
}: AdvancedSettingsProps) {
  const { data: registryData, loading } = useResource<RegistryData>(
    async () => {
      const res = await fetch("/api/registry");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return {
        tools: data.tools || [],
        skills: data.skills || [],
      };
    },
    [],
    { enabled: isOpen, onError: (e) => console.error("Failed to load registry:", e) },
  );
  const tools = registryData?.tools ?? [];
  const skills = registryData?.skills ?? [];

  const autoEnabledBySkills = useMemo(() => {
    const set = new Set<string>();
    for (const sid of enabledSkills) {
      const s = skills.find((x) => x.id === sid);
      if (s) for (const tid of s.toolIds) set.add(tid);
    }
    return set;
  }, [enabledSkills, skills]);

  const toolsByCategory = useMemo(() => {
    const groups: Record<string, ToolInfo[]> = {};
    for (const t of tools) {
      const cat = t.category || "Other";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(t);
    }
    return groups;
  }, [tools]);

  function toggleTool(id: string) {
    const set = new Set(enabledTools);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    onChange({ enabledTools: [...set], enabledSkills });
  }

  function toggleSkill(id: string) {
    const set = new Set(enabledSkills);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    onChange({ enabledTools, enabledSkills: [...set] });
  }

  if (!isOpen) return null;

  return (
    <SidePanel
      isOpen={isOpen}
      onClose={onClose}
      title="Advanced Settings"
      subtitle="Per-conversation tools & skills"
    >
          {loading ? (
            <div className="flex items-center gap-2 text-zinc-400">
              <Loader2 size={16} className="animate-spin" />
              Loading registry…
            </div>
          ) : (
            <>
              {/* Skills */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles size={16} className="text-purple-400" />
                  <h3 className="text-sm font-semibold text-white uppercase tracking-wider">
                    Skills
                  </h3>
                </div>
                <p className="text-xs text-zinc-500 mb-3">
                  A skill adds a system-prompt persona plus a bundle of tools.
                  Multiple can be on at once.
                </p>
                <div className="space-y-2">
                  {skills.map((s) => {
                    const on = enabledSkills.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        onClick={() => toggleSkill(s.id)}
                        className={`w-full text-left p-3 rounded-lg border transition ${
                          on
                            ? "border-purple-500 bg-purple-500/10"
                            : "glass-card hover:border-zinc-600"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-zinc-100 text-sm">
                                {s.name}
                              </span>
                              {s.toolIds.length > 0 && (
                                <span className="text-[10px] text-zinc-500 glass px-1.5 py-0.5 rounded">
                                  +{s.toolIds.length} tool{s.toolIds.length > 1 ? "s" : ""}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-zinc-400 mt-0.5">
                              {s.description}
                            </p>
                          </div>
                          <div
                            className={`shrink-0 mt-0.5 w-4 h-4 rounded border-2 ${
                              on
                                ? "bg-purple-500 border-purple-500"
                                : "border-zinc-600"
                            }`}
                          >
                            {on && (
                              <svg viewBox="0 0 12 12" className="text-white">
                                <path d="M2 6l3 3 5-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Tools */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Wrench size={16} className="text-blue-400" />
                  <h3 className="text-sm font-semibold text-white uppercase tracking-wider">
                    Tools
                  </h3>
                </div>
                <p className="text-xs text-zinc-500 mb-3">
                  Individual tools the model can call. Built-ins are always available.
                </p>

                {Object.entries(toolsByCategory).map(([cat, list]) => (
                  <div key={cat} className="mb-4">
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2 font-semibold">
                      {cat}
                    </div>
                    <div className="space-y-2">
                      {list.map((t) => {
                        const explicit = enabledTools.includes(t.id);
                        const auto = autoEnabledBySkills.has(t.id);
                        const on = explicit || auto || t.builtIn;
                        return (
                          <div
                            key={t.id}
                            className={`p-3 rounded-lg border transition ${
                              on
                                ? "border-blue-500/50 bg-blue-500/5"
                                : "glass-card"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium text-zinc-100 text-sm">
                                    {t.name}
                                  </span>
                                  <code className="text-[10px] text-zinc-500 glass px-1.5 py-0.5 rounded">
                                    {t.id}
                                  </code>
                                  {t.builtIn && (
                                    <span className="text-[10px] text-emerald-300 bg-emerald-900/50 px-1.5 py-0.5 rounded">
                                      built-in
                                    </span>
                                  )}
                                  {auto && !explicit && (
                                    <span className="text-[10px] text-purple-300 bg-purple-900/50 px-1.5 py-0.5 rounded">
                                      via skill
                                    </span>
                                  )}
                                  <span
                                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                                      t.serverSide
                                        ? "text-zinc-400 glass"
                                        : "text-orange-300 bg-orange-900/40"
                                    }`}
                                  >
                                    {t.serverSide ? "server" : "sandbox"}
                                  </span>
                                </div>
                                <p className="text-xs text-zinc-400 mt-1">
                                  {t.description}
                                </p>
                              </div>
                              {t.builtIn ? (
                                <div className="shrink-0 text-[10px] text-zinc-500 mt-1">
                                  always on
                                </div>
                              ) : (
                                <button
                                  onClick={() => toggleTool(t.id)}
                                  disabled={auto && !explicit}
                                  className={`shrink-0 mt-0.5 w-4 h-4 rounded border-2 transition ${
                                    explicit
                                      ? "bg-blue-500 border-blue-500"
                                      : auto
                                        ? "bg-purple-500/40 border-purple-500/40 cursor-not-allowed"
                                        : "border-zinc-600 hover:border-zinc-400"
                                  }`}
                                  title={
                                    auto && !explicit
                                      ? "Enabled by an active skill"
                                      : explicit
                                        ? "Click to disable"
                                        : "Click to enable"
                                  }
                                >
                                  {(explicit || auto) && (
                                    <svg viewBox="0 0 12 12" className="text-white">
                                      <path d="M2 6l3 3 5-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </section>

              <section className="text-xs text-zinc-500 border-t border-zinc-800 pt-4">
                <p className="font-medium text-zinc-400 mb-1">Adding your own</p>
                <p>
                  Edit{" "}
                  <code className="text-zinc-300">lib/registry/tools.ts</code>{" "}
                  or{" "}
                  <code className="text-zinc-300">lib/registry/skills.ts</code>.
                  New entries appear here automatically.
                </p>
              </section>
            </>
          )}
    </SidePanel>
  );
}
