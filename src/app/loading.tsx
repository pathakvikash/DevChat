export default function RootLoading() {
  return (
    <div className="flex h-screen">
      <aside className="w-64 glass-panel border-r border-[var(--glass-border)] p-4 flex flex-col gap-4">
        <div className="h-10 bg-zinc-800 rounded animate-pulse" />
        <div className="h-10 bg-zinc-800 rounded animate-pulse" />
        <div className="flex-1 space-y-3">
          <div className="h-14 bg-zinc-800 rounded animate-pulse" />
          <div className="h-14 bg-zinc-800 rounded animate-pulse" />
          <div className="h-14 bg-zinc-800 rounded animate-pulse" />
          <div className="h-14 bg-zinc-800 rounded animate-pulse" />
        </div>
        <div className="h-10 bg-zinc-800 rounded animate-pulse" />
      </aside>
      <main className="flex-1 p-8" style={{ backgroundColor: "var(--background)" }}>
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="h-8 w-64 bg-zinc-800 rounded animate-pulse" />
          <div className="h-4 w-96 bg-zinc-800 rounded animate-pulse" />
          <div className="space-y-4 pt-4">
            <div className="h-24 bg-zinc-800 rounded animate-pulse" />
            <div className="h-24 bg-zinc-800 rounded animate-pulse" />
            <div className="h-24 bg-zinc-800 rounded animate-pulse" />
          </div>
        </div>
      </main>
    </div>
  );
}
