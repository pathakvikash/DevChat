"use client";

interface EmptyStateProps {
  modelName: string;
}

export default function EmptyState({ modelName }: EmptyStateProps) {
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
