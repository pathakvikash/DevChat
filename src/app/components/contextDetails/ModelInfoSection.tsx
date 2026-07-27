"use client";

import SectionHeader from "../ui/SectionHeader";
import { formatContext } from "@/lib/utils/messageParts";

interface ModelInfoSectionProps {
  model: string;
  contextLength: number;
}

export default function ModelInfoSection({
  model,
  contextLength,
}: ModelInfoSectionProps) {
  return (
    <section>
      <SectionHeader>Model Information</SectionHeader>
      <div className="space-y-2 glass-card rounded-[var(--glass-radius-lg)] p-4">
        <div className="flex justify-between text-sm">
          <span className="text-zinc-400">Model</span>
          <span className="text-white font-mono">{model}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-zinc-400">Context Window</span>
          <span className="text-white font-mono">
            {formatContext(contextLength)} tokens
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-zinc-400">Provider</span>
          <span className="text-white">
            {model.startsWith("ollama/")
              ? "Ollama (Local)"
              : model.split("-")[0]}
          </span>
        </div>
      </div>
    </section>
  );
}
