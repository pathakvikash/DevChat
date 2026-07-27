"use client";

import { useEffect } from "react";

interface UseKeyboardShortcutsOptions {
  onSend?: () => void;
  onOpenCommandPalette?: () => void;
  onOpenKeyboardShortcuts?: () => void;
  isDialogOpen?: boolean;
  onCloseDialog?: () => void;
}

export function useKeyboardShortcuts({
  onSend,
  onOpenCommandPalette,
  onOpenKeyboardShortcuts,
  isDialogOpen,
  onCloseDialog,
}: UseKeyboardShortcutsOptions) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onOpenCommandPalette?.();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        onOpenKeyboardShortcuts?.();
        return;
      }

      if (e.key === "Escape" && isDialogOpen) {
        e.preventDefault();
        onCloseDialog?.();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        onSend?.();
        return;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onSend, onOpenCommandPalette, onOpenKeyboardShortcuts, isDialogOpen, onCloseDialog]);
}
