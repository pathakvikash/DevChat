import SidebarSkeleton from "@/app/components/ui/SidebarSkeleton";

export default function MemoryLoading() {
  return (
    <div className="flex h-screen bg-[var(--background)]">
      <SidebarSkeleton />
      <div className="flex-1 overflow-y-auto">
        <main className="text-[var(--foreground)] p-8 min-h-full">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-3">
                <div className="h-7 w-7 glass rounded animate-pulse" />
                <div className="h-8 w-48 glass rounded animate-pulse" />
              </div>
              <div className="flex gap-2">
                <div className="h-9 w-24 glass rounded animate-pulse" />
              </div>
            </div>
            <div className="h-4 w-96 glass rounded animate-pulse mb-8" />
            <div className="space-y-6">
              <div>
                <div className="h-4 w-20 glass rounded animate-pulse mb-2" />
                <div className="space-y-2">
                  <div className="h-20 glass-card rounded-[var(--glass-radius-lg)] animate-pulse" />
                  <div className="h-20 glass-card rounded-[var(--glass-radius-lg)] animate-pulse" />
                  <div className="h-20 glass-card rounded-[var(--glass-radius-lg)] animate-pulse" />
                </div>
              </div>
              <div>
                <div className="h-4 w-20 glass rounded animate-pulse mb-2" />
                <div className="space-y-2">
                  <div className="h-20 glass-card rounded-[var(--glass-radius-lg)] animate-pulse" />
                  <div className="h-20 glass-card rounded-[var(--glass-radius-lg)] animate-pulse" />
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
