"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown, ExternalLink } from "lucide-react";
import { useApps } from "@/app/hooks/useApps";
import { appHomeHref } from "@/lib/apps/ui";
import { AppIcon } from "./AppIcon";

/** The sidebar's Apps launcher: approved apps open in a new tab through /go. Hidden when there are none. */
export default function SidebarApps() {
  const { apps } = useApps();
  const [open, setOpen] = useState(true);
  const reduceMotion = useReducedMotion();
  if (apps.length === 0) return null;

  return (
    <div data-testid="sidebar-apps">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="nav-section flex w-full items-center justify-between focus-ring"
      >
        <span>Apps</span>
        <ChevronDown size={12} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {apps.map((app) => (
              <a
                key={app.id}
                href={appHomeHref(app.id)}
                target="_blank"
                rel="noopener"
                className="nav-row focus-ring"
                title={app.status === "unreachable" ? `${app.name} (unreachable)` : app.goodFor}
              >
                <AppIcon app={app} size={18} />
                <span className="min-w-0 flex-1 truncate">{app.name}</span>
                {app.status === "unreachable" && (
                  <span role="img" aria-label="Unreachable" className="size-1.5 shrink-0 rounded-full bg-red-400" />
                )}
                <ExternalLink size={12} className="shrink-0 text-zinc-500" aria-hidden="true" />
              </a>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
