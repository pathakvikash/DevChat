"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Menu, ChevronLeft, ChevronRight } from "lucide-react";
import Sidebar from "./Sidebar";
import { SidebarProvider, useSidebar } from "@/app/contexts/SidebarContext";

const SIDEBAR_WIDTH = 256;

/**
 * Mobile hamburger toggle. Must be rendered as a descendant of `AppShell`
 * (e.g. inside its `children`) — it consumes the SidebarProvider that
 * `AppShell` creates, and a component can't consume a context its own
 * returned JSX provides.
 */
export function SidebarToggleButton() {
  const { toggle } = useSidebar();
  return (
    <button onClick={toggle} className="md:hidden p-1.5 glass-button rounded transition shrink-0" title="Toggle sidebar">
      <Menu size={18} />
    </button>
  );
}

function AppShellInner({ children }: { children: React.ReactNode }) {
  const { isOpen, close, collapsed, toggleCollapsed } = useSidebar();

  return (
    <div className="relative flex h-screen bg-[var(--background)]">
      {/* Mobile sidebar: fixed overlay */}
      <AnimatePresence>
        {isOpen && (
          <div className="md:hidden fixed inset-0 z-40">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={close}
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring" as const, stiffness: 300, damping: 30 }}
              className="relative w-72 max-w-[80vw] h-full glass-panel-strong"
            >
              <Sidebar />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
      {/* Desktop sidebar */}
      <motion.div
        className="hidden md:flex overflow-hidden shrink-0"
        animate={{ width: collapsed ? 0 : SIDEBAR_WIDTH }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
      >
        <Sidebar />
      </motion.div>

      {/* Desktop collapse/expand handle */}
      <motion.button
        onClick={toggleCollapsed}
        animate={{ left: collapsed ? 8 : SIDEBAR_WIDTH - 12 }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className="hidden md:flex items-center justify-center absolute top-1/2 -translate-y-1/2 z-30 size-6 rounded-full glass-button text-zinc-400 hover:text-zinc-100 transition-colors"
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </motion.button>

      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

/** Standard page shell: sidebar (fixed on desktop, collapsible drawer on mobile) + scrollable content area. */
export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppShellInner>{children}</AppShellInner>
    </SidebarProvider>
  );
}
