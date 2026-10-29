"use client";

import { useEffect } from "react";

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
