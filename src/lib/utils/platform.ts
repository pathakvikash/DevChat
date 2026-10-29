/** True on Apple devices, where the shortcut key is ⌘ rather than Ctrl. Read lazily so SSR never touches `navigator`. */
export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
}

/** Shortcut text for tooltips and hints: `⌘↵` on Mac, `Ctrl+Enter` elsewhere. */
export function sendShortcutLabel(): string {
  return isMac() ? "⌘↵" : "Ctrl+Enter";
}
