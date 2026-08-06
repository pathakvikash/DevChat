"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useResource } from "@/app/hooks/useResource";

interface Persona {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  isBuiltIn: boolean;
}

interface PersonaSelectorProps {
  value?: string;
  onSelect: (persona: Persona) => void;
  disabled?: boolean;
}

export default function PersonaSelector({
  value,
  onSelect,
  disabled = false,
}: PersonaSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const { data: personasData, loading } = useResource<Persona[]>(
    async () => {
      const res = await fetch("/api/personas");
      if (!res.ok) throw new Error("Failed to fetch personas");
      return res.json();
    },
    [],
    { onError: (e) => console.error("Failed to fetch personas:", e) },
  );
  const personas = personasData ?? [];
  const selectedPersona = personas.find((p) => p.id === value);

  return (
    // inline-block so the menu anchors to the button, not the whole dialog.
    <div className="relative inline-block" ref={rootRef}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled || loading}
        className="flex items-center gap-2 glass-button text-[var(--foreground)] rounded-[var(--glass-radius-md)] px-3 py-2 text-sm transition disabled:cursor-not-allowed"
      >
        {loading ? "Loading..." : selectedPersona?.name || "Select Persona"}
        <ChevronDown size={16} />
      </button>

      {isOpen && !loading && (
        <div
          role="listbox"
          className="absolute left-0 mt-2 w-64 max-h-72 overflow-y-auto glass-panel-strong rounded-[var(--glass-radius-md)] shadow-lg z-50"
        >
          {personas.map((persona) => (
            <button
              key={persona.id}
              onClick={() => {
                onSelect(persona);
                setIsOpen(false);
              }}
              className={`w-full text-left px-4 py-3 text-sm hover:bg-[var(--glass-bg-hover)] border-b border-[var(--glass-border)] last:border-b-0 ${
                value === persona.id ? "bg-[var(--glass-bg-active)]" : ""
              }`}
            >
              <div className="font-medium">{persona.name}</div>
              <div className="text-xs text-zinc-400">{persona.description}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
