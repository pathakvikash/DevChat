"use client";

import { FileCode, FileText, FileSpreadsheet, FileJson, Image, GitBranch, Globe } from "lucide-react";

const TYPE_ICONS: Record<string, typeof FileCode> = {
  code: FileCode,
  document: FileText,
  report: FileSpreadsheet,
  table: FileJson,
  svg: Image,
  mermaid: GitBranch,
  html: Globe,
};

const TYPE_COLORS: Record<string, string> = {
  code: "text-blue-400",
  document: "text-green-400",
  report: "text-amber-400",
  table: "text-purple-400",
  svg: "text-cyan-400",
  mermaid: "text-pink-400",
  html: "text-orange-400",
};

interface ArtifactReferenceProps {
  artifactId: string;
  title: string;
  type: string;
  version: number;
  onClick: (artifactId: string) => void;
}

export default function ArtifactReference({
  artifactId,
  title,
  type,
  version,
  onClick,
}: ArtifactReferenceProps) {
  const Icon = TYPE_ICONS[type] || FileText;
  const colorClass = TYPE_COLORS[type] || "text-zinc-400";

  return (
    <button
      onClick={() => onClick(artifactId)}
      className="flex items-center gap-2.5 glass-button rounded-[var(--glass-radius-md)] px-3 py-2 cursor-pointer text-left w-full"
    >
      <Icon size={16} className={`${colorClass} shrink-0`} />
      <span className="text-sm text-zinc-200 truncate flex-1 min-w-0">
        {title}
      </span>
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded glass text-zinc-400 shrink-0">
        v{version}
      </span>
    </button>
  );
}
