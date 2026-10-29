"use client";

import PaneBar from "./PaneBar";
import { useSplitView } from "./SplitViewContext";

/**
 * Placeholder for a pane that is not the first one. The real chat pane replaces the body
 * below; the props stay as they are. It reports busy state through useSplitView().setPaneBusy.
 */
export default function PaneSlot({
  conversationId,
  focused,
  onFocus,
  onClose,
}: {
  conversationId: string;
  focused: boolean;
  onFocus: () => void;
  onClose: () => void;
}) {
  const split = useSplitView();
  return (
    <div className="flex min-h-0 flex-1 flex-col" onFocusCapture={onFocus}>
      <PaneBar
        title={split.info[conversationId]?.title ?? "Chat"}
        focused={focused}
        onClose={onClose}
        warning={split.warnings[conversationId]}
        onWarningClick={() => split.focusPane(split.warnings[conversationId]?.otherId ?? conversationId)}
      />
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400" aria-busy="true">
        Loading chat…
      </div>
    </div>
  );
}
