"use client";

interface AttachmentChipProps {
  file: File;
  onRemove: () => void;
  preview?: string;
}

export default function AttachmentChip({
  file,
  onRemove,
  preview,
}: AttachmentChipProps) {
  const isImage = file.type.startsWith("image/");

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <div className="group relative flex items-center gap-3 rounded-[var(--glass-radius-md)] glass-card p-3 transition-all hover:border-[var(--glass-border-hover)]">
      {isImage && preview ? (
        <img
          src={preview}
          alt={file.name}
          className="h-10 w-10 rounded-[var(--glass-radius-sm)] object-cover"
        />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded-[var(--glass-radius-sm)] glass-strong text-lg">
          📎
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-medium text-zinc-200">
          {file.name}
        </p>
        <p className="text-xs text-zinc-500">{formatFileSize(file.size)}</p>
      </div>

      <button
        onClick={onRemove}
        className="flex h-6 w-6 items-center justify-center rounded-full glass-strong text-zinc-400 opacity-0 transition-all hover:bg-red-600 hover:text-white group-hover:opacity-100"
        aria-label="Remove attachment"
      >
        ×
      </button>
    </div>
  );
}
