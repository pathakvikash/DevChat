import SidebarSkeleton from "@/app/components/ui/SidebarSkeleton";

export default function SettingsLoading() {
  return (
    <div className="flex h-screen bg-[var(--background)]">
      <SidebarSkeleton />
      <div className="flex-1 overflow-y-auto">
        <main className="text-[var(--foreground)] p-8">
          <div className="flex items-center justify-between mb-8">
            <div className="h-8 w-56 glass rounded animate-pulse" />
            <div className="h-10 w-36 glass rounded animate-pulse" />
          </div>
          <div className="space-y-8 max-w-4xl">
            <div className="glass-card rounded-[var(--glass-radius-xl)] p-6 space-y-5">
              <div className="h-6 w-24 glass rounded animate-pulse" />
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="h-4 w-32 glass rounded animate-pulse" />
                  <div className="h-9 glass rounded animate-pulse" />
                </div>
                <div className="space-y-2">
                  <div className="h-4 w-32 glass rounded animate-pulse" />
                  <div className="h-9 glass rounded animate-pulse" />
                </div>
              </div>
            </div>
            <div className="glass-card rounded-[var(--glass-radius-xl)] p-6 space-y-4">
              <div className="h-6 w-20 glass rounded animate-pulse" />
              <div className="h-9 glass rounded animate-pulse" />
            </div>
            <div className="glass-card rounded-[var(--glass-radius-xl)] p-6 space-y-4">
              <div className="h-6 w-28 glass rounded animate-pulse" />
              <div className="h-9 glass rounded animate-pulse" />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
