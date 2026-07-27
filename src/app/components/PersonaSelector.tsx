"use client";

import { useState } from "react";
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
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled || loading}
        className="flex items-center gap-2 glass-button text-[var(--foreground)] rounded-[var(--glass-radius-md)] px-3 py-2 text-sm transition disabled:cursor-not-allowed"
      >
        {loading ? "Loading..." : selectedPersona?.name || "Select Persona"}
        <ChevronDown size={16} />
      </button>

      {isOpen && !loading && (
        <div className="absolute right-0 mt-2 w-64 glass-panel rounded-[var(--glass-radius-md)] shadow-lg z-50">
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
