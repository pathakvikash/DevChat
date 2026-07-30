"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Menu } from "lucide-react";
import Sidebar from "./Sidebar";
import { SidebarProvider, useSidebar } from "@/app/contexts/SidebarContext";

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
  const { isOpen, close } = useSidebar();

  return (
    <div className="flex h-screen bg-[var(--background)]">
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
      <div className="hidden md:flex">
        <Sidebar />
      </div>
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
