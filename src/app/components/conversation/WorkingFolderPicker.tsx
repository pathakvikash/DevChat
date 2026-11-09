"use client";

import { FolderOpen } from "lucide-react";
import { shortenHome, useClaudeProjects } from "@/app/hooks/useClaudeProjects";

interface WorkingFolderPickerProps {
  value: string | null;
  onChange: (folder: string | null) => void;
  disabled?: boolean;
  /** Accessible name, and a tooltip that replaces the chat one (for example in a workflow card). */
  label?: string;
  hint?: string;
}

/** Folder a CLI-backed model may work in, chosen from folders Claude Code has used.
 *  The model settings dialog carries the same control. */
export default function WorkingFolderPicker({ value, onChange, disabled, label, hint }: WorkingFolderPickerProps) {
  const { folders } = useClaudeProjects();
  const short = shortenHome;

  return (
    <label
      className="flex h-8 items-center gap-1.5 rounded-[var(--glass-radius-md)] glass-button px-2 text-xs text-zinc-300"
      title={hint ?? (value ? `Working folder: ${value}. Type @ to mention a file.` : "No working folder: the tool can't see any files")}
    >
      <FolderOpen size={13} className={value ? "text-emerald-400" : "text-zinc-500"} />
      <select
        aria-label={label}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        className="max-w-[10rem] truncate bg-transparent outline-none disabled:opacity-50"
      >
        <option value="">No folder</option>
        {folders.map((p) => (
          <option key={p.cwd} value={p.cwd}>
            {short(p.cwd)}
          </option>
        ))}
        {value && !folders.some((p) => p.cwd === value) && <option value={value}>{short(value)}</option>}
      </select>
    </label>
  );
}
