"use client";

import Sidebar from "@/app/components/Sidebar";
import { SidebarProvider, useSidebar } from "@/app/contexts/SidebarContext";
import { ChatModeProvider } from "@/app/contexts/ChatModeContext";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";

const SIDEBAR_WIDTH = 256;

function LayoutInner({ children }: { children: React.ReactNode }) {
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

      <div className="flex-1 flex flex-col min-w-0">{children}</div>
    </div>
  );
}

export default function ConversationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      {/* Above LayoutInner so the sidebar and header share one mode state. */}
      <ChatModeProvider>
        <LayoutInner>{children}</LayoutInner>
      </ChatModeProvider>
    </SidebarProvider>
  );
}
