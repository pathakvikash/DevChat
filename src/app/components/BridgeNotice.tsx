"use client";

import { bridgeProblemText, isBridgeModel } from "@/lib/bridge/client";
import { useBridge, useBridgeFolder } from "@/app/hooks/useBridge";
import { useFolders } from "@/app/hooks/useFolders";

/** One status line above the composer for a chat on a local-bridge model: bridge problems, no folder, and "Reply not saved". */
export default function BridgeNotice({ conversationId, model, saveFailed, onRetry }: { conversationId: string; model: string; saveFailed: boolean; onRetry: () => void }) {
  const bridge = useBridge();
  const folder = useBridgeFolder(conversationId);
  const { noHostTools } = useFolders(true, { bridge: true });
  const active = isBridgeModel(model) && noHostTools === true;

  const lines: React.ReactNode[] = [];
  if (active && bridge.status !== "ready") {
    lines.push(
      <span key="problem">
        {bridgeProblemText(bridge.status, bridge.protocol)}{" "}
        {bridge.hasToken && (
          <button type="button" onClick={() => void bridge.check()} disabled={bridge.checking} className="focus-ring underline disabled:opacity-50">
            Check again
          </button>
        )}
      </span>,
    );
  } else if (active && !folder) {
    lines.push(<span key="folder">No folder selected: Claude Code runs with no tools.</span>);
  }
  if (saveFailed) {
    lines.push(
      <span key="save" className="text-amber-300">
        Reply not saved: it stays on screen.{" "}
        <button type="button" onClick={onRetry} className="focus-ring underline">
          Retry
        </button>
      </span>,
    );
  }

  return (
    <div role="status" data-testid="bridge-notice" className={lines.length ? "flex flex-col gap-0.5 px-4 pb-1.5 text-xs text-zinc-400" : undefined}>
      {lines}
    </div>
  );
}
