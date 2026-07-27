"use client";

import Sidebar from "@/app/components/Sidebar";
import { SidebarProvider, useSidebar } from "@/app/contexts/SidebarContext";
import { motion, AnimatePresence } from "framer-motion";

function LayoutInner({ children }: { children: React.ReactNode }) {
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
      <LayoutInner>{children}</LayoutInner>
    </SidebarProvider>
  );
}
