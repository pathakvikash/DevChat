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
export type AltKey = "A" | "P" | "M" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8";
export type AltShortcuts = Partial<Record<AltKey, () => void>>;

/** The character each shortcut types with Option on a US layout. In a text field, only this key counts as the shortcut. */
const ALT_US_OUTPUT: Record<AltKey, string> = {
  A: "å",
  P: "π",
  M: "µ",
  "1": "¡",
  "2": "™",
  "3": "£",
  "4": "¢",
  "5": "∞",
  "6": "§",
  "7": "¶",
  "8": "•",
};

export interface AltKeyEvent {
  code: string;
  key: string;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
  target: EventTarget | null;
  preventDefault(): void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable === true || el.tagName === "TEXTAREA" || el.tagName === "INPUT");
}

/**
 * Which Option shortcut this key event is, or null. Matches on `e.code` (Option+letter types another character on a Mac).
 * In an editable target, Option types a character on non-US layouts (German Option+5 types `[`), so the shortcut
 * runs only when `e.key` is the US Option output; elsewhere the key is matched alone.
 */
export function altShortcutFor(e: AltKeyEvent): AltKey | null {
  if (e.defaultPrevented || !e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return null;
  const m = /^(?:Key([A-Z])|Digit([1-8]))$/.exec(e.code);
  const key = m ? ((m[1] ?? m[2]) as AltKey) : null;
  if (!key || !(key in ALT_US_OUTPUT)) return null;
  if (isEditableTarget(e.target) && e.key !== ALT_US_OUTPUT[key]) return null;
  return key;
}

/** Runs the Option shortcut for this event if it has one. Returns true when it ran (and prevented the default). */
export function runAltShortcut(e: AltKeyEvent, handlers: AltShortcuts | undefined): boolean {
  const key = altShortcutFor(e);
  const run = key ? handlers?.[key] : undefined;
  if (!run) return false;
  e.preventDefault();
  run();
  return true;
}

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
      runAltShortcut(e, ref.current);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active]);
}
