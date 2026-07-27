export default function KnowledgeBaseLoading() {
  return (
    <div className="flex h-screen">
      <aside className="w-64 glass-panel border-r border-[var(--glass-border)] p-4 flex flex-col gap-4">
        <div className="h-10 bg-zinc-800 rounded animate-pulse" />
        <div className="h-10 bg-zinc-800 rounded animate-pulse" />
        <div className="flex-1 space-y-3">
          <div className="h-14 bg-zinc-800 rounded animate-pulse" />
          <div className="h-14 bg-zinc-800 rounded animate-pulse" />
        </div>
        <div className="h-10 bg-zinc-800 rounded animate-pulse" />
      </aside>
      <div className="flex-1 overflow-y-auto">
        <main className="p-8" style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}>
          <div className="h-8 w-72 bg-zinc-800 rounded animate-pulse mb-8" />
          <div className="grid grid-cols-3 gap-8 max-w-6xl">
            <div className="col-span-1">
              <div className="glass-card rounded-[var(--glass-radius-lg)] p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="h-5 w-28 bg-zinc-800 rounded animate-pulse" />
                  <div className="h-7 w-12 bg-zinc-800 rounded animate-pulse" />
                </div>
                <div className="space-y-2">
                  <div className="h-16 bg-zinc-800 rounded animate-pulse" />
                  <div className="h-16 bg-zinc-800 rounded animate-pulse" />
                  <div className="h-16 bg-zinc-800 rounded animate-pulse" />
                </div>
              </div>
            </div>
            <div className="col-span-2">
              <div className="glass-card rounded-[var(--glass-radius-lg)] p-6 space-y-6">
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <div className="h-7 w-48 bg-zinc-800 rounded animate-pulse" />
                    <div className="h-4 w-32 bg-zinc-800 rounded animate-pulse" />
                  </div>
                  <div className="h-8 w-8 bg-zinc-800 rounded animate-pulse" />
                </div>
                <div className="h-32 bg-zinc-800 rounded-lg animate-pulse" />
                <div className="space-y-3">
                  <div className="h-5 w-32 bg-zinc-800 rounded animate-pulse" />
                  <div className="h-14 bg-zinc-800 rounded animate-pulse" />
                  <div className="h-14 bg-zinc-800 rounded animate-pulse" />
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
