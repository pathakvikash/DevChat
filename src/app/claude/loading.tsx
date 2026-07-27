export default function ClaudeLoading() {
  return (
    <div className="flex h-screen bg-[var(--background)]">
      <aside className="w-64 glass-panel-strong border-r border-[var(--glass-border)] p-4 flex flex-col gap-4">
        <div className="h-10 glass rounded animate-pulse" />
        <div className="h-10 glass rounded animate-pulse" />
        <div className="flex-1 space-y-3">
          <div className="h-14 glass rounded animate-pulse" />
          <div className="h-14 glass rounded animate-pulse" />
        </div>
        <div className="h-10 glass rounded animate-pulse" />
      </aside>
      <div className="flex-1 overflow-y-auto">
        <main className="text-[var(--foreground)] p-8">
          <div className="max-w-5xl mx-auto space-y-8">
            <div className="h-8 w-48 glass rounded animate-pulse" />
            <div className="h-4 w-64 glass rounded animate-pulse" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="glass-card rounded-[var(--glass-radius-xl)] p-5 space-y-2">
                  <div className="h-4 w-16 glass rounded animate-pulse" />
                  <div className="h-8 w-12 glass rounded animate-pulse" />
                </div>
              ))}
            </div>
            <div className="glass-card rounded-[var(--glass-radius-xl)] p-6 space-y-4">
              <div className="h-6 w-24 glass rounded animate-pulse" />
              <div className="h-32 glass rounded animate-pulse" />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
