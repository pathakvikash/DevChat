export default function ConversationLoading() {
  return (
    <div className="flex h-screen">
      <main className="flex h-screen flex-1 min-w-0 flex-col" style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--glass-border)] glass">
          <div className="flex items-center gap-3">
            <div className="h-5 w-40 bg-zinc-800 rounded animate-pulse" />
            <div className="h-5 w-24 bg-zinc-800 rounded-full animate-pulse" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 bg-zinc-800 rounded animate-pulse" />
            <div className="h-8 w-8 bg-zinc-800 rounded animate-pulse" />
            <div className="h-8 w-8 bg-zinc-800 rounded animate-pulse" />
            <div className="h-8 w-8 bg-zinc-800 rounded animate-pulse" />
            <div className="h-8 w-8 bg-zinc-800 rounded animate-pulse" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
          <div className="flex justify-start">
            <div className="max-w-[80%] space-y-2">
              <div className="h-3 w-16 bg-zinc-800 rounded animate-pulse" />
              <div className="h-4 w-72 bg-zinc-800 rounded animate-pulse" />
              <div className="h-4 w-48 bg-zinc-800 rounded animate-pulse" />
            </div>
          </div>
          <div className="flex justify-end">
            <div className="max-w-[80%] space-y-2">
              <div className="h-3 w-16 bg-zinc-800 rounded ml-auto animate-pulse" />
              <div className="h-4 w-64 bg-zinc-800 rounded animate-pulse" />
              <div className="h-4 w-56 bg-zinc-800 rounded animate-pulse" />
              <div className="h-4 w-40 bg-zinc-800 rounded animate-pulse" />
            </div>
          </div>
          <div className="flex justify-start">
            <div className="max-w-[80%] space-y-2">
              <div className="h-3 w-16 bg-zinc-800 rounded animate-pulse" />
              <div className="h-4 w-80 bg-zinc-800 rounded animate-pulse" />
              <div className="h-4 w-60 bg-zinc-800 rounded animate-pulse" />
              <div className="h-4 w-36 bg-zinc-800 rounded animate-pulse" />
              <div className="h-4 w-52 bg-zinc-800 rounded animate-pulse" />
            </div>
          </div>
          <div className="flex justify-end">
            <div className="max-w-[80%] space-y-2">
              <div className="h-3 w-16 bg-zinc-800 rounded ml-auto animate-pulse" />
              <div className="h-4 w-48 bg-zinc-800 rounded animate-pulse" />
            </div>
          </div>
        </div>

        <div className="border-t border-[var(--glass-border)] p-4">
          <div className="h-12 bg-zinc-800 rounded-xl animate-pulse" />
        </div>
      </main>
    </div>
  );
}
