"use client";

import { Component, type ReactNode } from "react";

/** Keeps one pane's crash from taking the other panes down. */
export default class PaneErrorBoundary extends Component<{ onClose: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-zinc-400">
        <p>This chat failed to load.</p>
        <button
          type="button"
          onClick={this.props.onClose}
          className="rounded-[var(--glass-radius-sm)] glass-button px-3 py-1.5 text-[var(--foreground)]"
        >
          Close
        </button>
      </div>
    );
  }
}
