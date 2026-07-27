"use client";

import { FileText } from "lucide-react";
import type { FilePart } from "@/lib/utils/messageParts";

interface FileAttachmentsProps {
  fileParts: FilePart[];
}

export default function FileAttachments({ fileParts }: FileAttachmentsProps) {
  if (fileParts.length === 0) return null;

  return (
    <div className="mb-3 space-y-2">
      {fileParts.map((part, index) => {
        const src = part.url || part.image;
        const isImage = part.mediaType?.startsWith("image/") || part.type === "image";
        if (isImage && src) {
          const isValid = src.startsWith("https://") || src.startsWith("data:image/");
          if (!isValid) {
            return (
              <div key={index} className="flex items-center gap-2 glass-card rounded-[var(--glass-radius-md)] px-3 py-2 text-sm">
                <FileText size={16} className="text-zinc-400 shrink-0" />
                <span className="text-zinc-500 italic">Invalid image source</span>
              </div>
            );
          }
          return (
            <img
              key={index}
              src={src}
              alt={part.filename || `attachment-${index}`}
              className="max-w-full max-h-64 rounded-[var(--glass-radius-md)] border border-[var(--glass-border)]"
            />
          );
        }
        return (
          <div
            key={index}
            className="flex items-center gap-2 glass-card rounded-[var(--glass-radius-md)] px-3 py-2 text-sm"
          >
            <FileText size={16} className="text-zinc-400 shrink-0" />
            <span className="truncate">{part.filename || part.mediaType || "file"}</span>
          </div>
        );
      })}
    </div>
  );
}
