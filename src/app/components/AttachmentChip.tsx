"use client";

import { AlertTriangle, FileText } from "lucide-react";

interface AttachmentChipProps {
  /** An upload, or an `@` file as just its path. */
  file: { name: string; size?: number; type?: string };
  onRemove: () => void;
  preview?: string;
  /** Shown under the name, e.g. "Trimmed" for an `@` file that will be cut on send. */
  note?: { text: string; title: string };
}

export default function AttachmentChip({
  file,
  onRemove,
  preview,
  note,
}: AttachmentChipProps) {
  const isImage = file.type?.startsWith("image/") ?? false;

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <div role="listitem" className="group relative flex items-center gap-3 rounded-[var(--glass-radius-md)] glass-card p-3 transition-all hover:border-[var(--glass-border-hover)]">
      {isImage && preview ? (
        <img
          src={preview}
          alt={file.name}
          className="h-10 w-10 rounded-[var(--glass-radius-sm)] object-cover"
        />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded-[var(--glass-radius-sm)] glass-strong">
          <FileText size={18} aria-hidden className="text-zinc-400" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-medium text-zinc-200">
          {file.name}
        </p>
        {file.size !== undefined && <p className="text-xs text-zinc-500">{formatFileSize(file.size)}</p>}
        {note && (
          <p className="flex items-center gap-1 text-xs text-zinc-400" title={note.title}>
            <AlertTriangle size={12} aria-hidden className="shrink-0 text-amber-400" />
            {note.text}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onRemove}
        className="focus-ring flex h-6 w-6 items-center justify-center rounded-full glass-strong text-zinc-400 transition-all hover:bg-red-600 hover:text-white"
        aria-label={`Remove ${file.name}`}
        title={`Remove ${file.name}`}
      >
        ×
      </button>
    </div>
  );
}
