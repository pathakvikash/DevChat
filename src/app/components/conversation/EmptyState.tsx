"use client";

import { MessageSquareDashed } from "lucide-react";

interface EmptyStateProps {
  modelName: string;
  temporary?: boolean;
}

export default function EmptyState({ modelName, temporary }: EmptyStateProps) {
  if (temporary) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-zinc-400 px-6">
        <MessageSquareDashed size={40} className="mb-4" />
        <h2 className="text-xl font-semibold text-zinc-300 mb-2">Temporary chat</h2>
        <p className="text-sm text-center max-w-md">
          Not in your history or search, and memory is off. Deleted when you leave or after 24 hours.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 px-6">
      <div className="text-5xl mb-4">💬</div>
      <h2 className="text-xl font-semibold text-zinc-300 mb-2">
        Start the conversation
      </h2>
      <p className="text-sm text-center max-w-md">
        Ask anything. Currently using{" "}
        <span className="text-zinc-300 font-medium">{modelName}</span>
        . Switch models from the dropdown in the input bar below.
      </p>
    </div>
  );
}
