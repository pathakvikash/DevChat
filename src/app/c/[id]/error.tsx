"use client";

import { AlertTriangle } from "lucide-react";

export default function ConversationError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex h-screen items-center justify-center bg-[var(--background)] text-[var(--foreground)] p-8">
      <div className="flex flex-col items-center text-center max-w-md">
        <AlertTriangle size={48} className="text-red-500 mb-4" />
        <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
        <p className="text-[var(--foreground)]/60 text-sm mb-6">
          {error.message || "Failed to load this conversation."}
        </p>
        <button
          onClick={reset}
          className="px-5 py-2.5 glass-button-primary text-white rounded transition font-medium"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
