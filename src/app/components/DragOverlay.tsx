"use client";

interface DragOverlayProps {
  isVisible: boolean;
  fileCount: number;
}

export default function DragOverlay({
  isVisible,
  fileCount,
}: DragOverlayProps) {
  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-blue-500/10 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-blue-400 glass-strong p-8 text-center shadow-2xl">
        <div className="text-6xl">📁</div>
        <div>
          <h3 className="text-xl font-semibold text-white">
            Drop files to attach
          </h3>
          <p className="text-sm text-zinc-400">
            {fileCount > 0
              ? `Adding ${fileCount} file${fileCount > 1 ? "s" : ""}...`
              : "Release to upload"}
          </p>
        </div>
        <div className="flex gap-2">
          <div className="h-2 w-2 rounded-full bg-blue-400 animate-bounce [animation-delay:-0.3s]" />
          <div className="h-2 w-2 rounded-full bg-blue-400 animate-bounce [animation-delay:-0.15s]" />
          <div className="h-2 w-2 rounded-full bg-blue-400 animate-bounce" />
        </div>
      </div>
    </div>
  );
}
