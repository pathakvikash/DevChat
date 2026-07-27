"use client";

interface TypingIndicatorProps {
  isVisible: boolean;
}

export default function TypingIndicator({ isVisible }: TypingIndicatorProps) {
  if (!isVisible) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2 text-sm text-zinc-400">
      <div className="flex gap-1">
        <div className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce [animation-delay:-0.3s]" />
        <div className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce [animation-delay:-0.15s]" />
        <div className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce" />
      </div>
      <span>AI is thinking...</span>
    </div>
  );
}
