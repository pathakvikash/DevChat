"use client";

import { useEffect, useRef } from "react";

interface UseKeyboardShortcutsOptions {
  onSend?: () => void;
  onOpenCommandPalette?: () => void;
  onOpenKeyboardShortcuts?: () => void;
  isDialogOpen?: boolean;
  onCloseDialog?: () => void;
  onToggleSidePane?: () => void;
}

export function useKeyboardShortcuts({
  onSend,
  onOpenCommandPalette,
  onOpenKeyboardShortcuts,
  isDialogOpen,
  onCloseDialog,
  onToggleSidePane,
}: UseKeyboardShortcutsOptions) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // A component that handled the key already (and said so) owns it.
      if (e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "k" && onOpenCommandPalette) {
        e.preventDefault();
        onOpenCommandPalette?.();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "/" && onOpenKeyboardShortcuts) {
        e.preventDefault();
        onOpenKeyboardShortcuts?.();
        return;
      }

      if (e.key === "Escape" && isDialogOpen && onCloseDialog) {
        e.preventDefault();
        onCloseDialog?.();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "\\" && onToggleSidePane) {
        e.preventDefault();
        onToggleSidePane?.();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && onSend) {
        e.preventDefault();
        onSend?.();
        return;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onSend, onOpenCommandPalette, onOpenKeyboardShortcuts, isDialogOpen, onCloseDialog, onToggleSidePane]);
}

/** Option-key shortcuts for the Activity popover and side panel. Keys are `e.code` suffixes ("A", "P", "M", "1"-"8"). */
export type AltShortcuts = Partial<Record<"A" | "P" | "M" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8", () => void>>;

/** Matches on `e.code` (Option+letter types a different character on a Mac) and on Alt alone. Pass undefined when the pane is not focused. */
export function useAltShortcuts(handlers: AltShortcuts | undefined) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  const active = !!handlers;
  useEffect(() => {
    if (!active) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || !e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const key = /^(?:Key([A-Z])|Digit([1-8]))$/.exec(e.code);
      const run = key && ref.current?.[(key[1] ?? key[2]) as keyof AltShortcuts];
      if (!run) return;
      e.preventDefault();
      run();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active]);
}
