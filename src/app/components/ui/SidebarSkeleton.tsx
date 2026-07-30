/** Sidebar placeholder shown by route-level loading.tsx files while the real Sidebar streams in. */
export default function SidebarSkeleton() {
  return (
    <aside className="w-64 glass-panel-strong border-r border-[var(--glass-border)] p-4 flex flex-col gap-4">
      <div className="h-10 glass rounded animate-pulse" />
      <div className="h-10 glass rounded animate-pulse" />
      <div className="flex-1 space-y-3">
        <div className="h-14 glass rounded animate-pulse" />
        <div className="h-14 glass rounded animate-pulse" />
      </div>
      <div className="h-10 glass rounded animate-pulse" />
    </aside>
  );
}
