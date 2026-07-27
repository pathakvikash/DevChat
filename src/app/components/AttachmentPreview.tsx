"use client";

import { useEffect, useState } from "react";

interface AttachmentPreviewProps {
  file: File;
  onRemove: () => void;
}

export default function AttachmentPreview({
  file,
  onRemove,
}: AttachmentPreviewProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const isImage = file.type.startsWith("image/");

  useEffect(() => {
    if (isImage) {
      const url = URL.createObjectURL(file);
      setPreview(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [file, isImage]);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  if (isImage && preview) {
    return (
      <div className="group relative max-w-xs">
        <div
          className="relative cursor-pointer overflow-hidden rounded-[var(--glass-radius-lg)] glass-card transition-all"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <img
            src={preview}
            alt={file.name}
            className="h-32 w-full object-cover"
          />
          <div className="absolute inset-0 bg-black/0 transition-all group-hover:bg-black/20" />

          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-all hover:bg-red-600 group-hover:opacity-100"
            aria-label="Remove image"
          >
            ×
          </button>
        </div>

        <div className="mt-2 flex items-center justify-between text-xs text-zinc-400">
          <span className="truncate">{file.name}</span>
          <span>{formatFileSize(file.size)}</span>
        </div>

        {isExpanded && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
            onClick={() => setIsExpanded(false)}
          >
            <div className="relative max-h-full max-w-full">
              <img
                src={preview}
                alt={file.name}
                className="max-h-full max-w-full rounded-lg object-contain"
              />
              <button
                onClick={() => setIsExpanded(false)}
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
              >
                ×
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-3 rounded-[var(--glass-radius-lg)] glass-card p-3 transition-all">
      <div className="flex h-10 w-10 items-center justify-center rounded-[var(--glass-radius-md)] glass-strong text-lg">
        📎
      </div>

      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-medium text-zinc-200">
          {file.name}
        </p>
        <p className="text-xs text-zinc-500">{formatFileSize(file.size)}</p>
      </div>

      <button
        onClick={onRemove}
        className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-700 text-zinc-400 opacity-0 transition-all hover:bg-red-600 hover:text-white group-hover:opacity-100"
        aria-label="Remove file"
      >
        ×
      </button>
    </div>
  );
}
