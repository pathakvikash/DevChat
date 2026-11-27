"use client";

import { useId, useState } from "react";
import { bridgeProblemText } from "@/lib/bridge/client";
import { forgetBridgeToken, saveBridgeToken, useBridge, useBridgeProbe } from "@/app/hooks/useBridge";

const btn = "focus-ring glass-button h-9 rounded-[var(--glass-radius-md)] px-4 text-sm font-medium disabled:opacity-50";

/** Settings > Local bridge: pairing, status and the start commands. Opening it is what probes the bridge (when a token is stored). */
export default function BridgeSettings() {
  const bridge = useBridge();
  const [draft, setDraft] = useState("");
  const inputId = useId();
  useBridgeProbe(true);

  let status: string;
  if (bridge.checking) status = "Checking the bridge…";
  else if (bridge.status === "ready") status = `Connected: bridge ${bridge.version ?? ""}, ${bridge.folders.length} folder${bridge.folders.length === 1 ? "" : "s"} allowed.`;
  else if (bridge.status === "unpaired") status = bridge.hasToken && bridge.checkedAt ? "The bridge did not accept this token. Paste it again, or run: npm run bridge -- --print-token" : "Not paired. Paste the token the bridge printed.";
  else status = bridgeProblemText(bridge.status, bridge.protocol) ?? "";

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-400">
        The local bridge is a small program on your computer that lets this page use your own Claude Code. The page talks to it directly on 127.0.0.1; nothing you
        run goes through this server. Bridge chats use Claude Code&apos;s own tools (no Orrery memory, knowledge bases or generated interfaces), and bridge models work only on the
        computer running the bridge.
      </p>
      <p className="text-sm text-zinc-400">
        By default the bridge is read-only (Plan): Claude Code can read the folders you add and change nothing. To allow edits, run{" "}
        <code className="font-mono text-zinc-200">npm run bridge -- --max-mode agent</code>. To allow commands, run{" "}
        <code className="font-mono text-zinc-200">npm run bridge -- --max-mode ask</code>: each edit then needs your OK in the page, and each command is also confirmed in the
        bridge&apos;s terminal.
      </p>
      <pre className="glass-input overflow-x-auto rounded-[var(--glass-radius-md)] px-3 py-2 text-xs font-mono text-zinc-200 select-all">
        {"npm run bridge\nnpm run bridge -- --add /path/to/project"}
      </pre>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void saveBridgeToken(draft);
          setDraft("");
        }}
      >
        <div className="min-w-0 flex-1 basis-60">
          <label htmlFor={inputId} className="mb-1 block text-xs text-zinc-400">
            Bridge token
          </label>
          <input
            id={inputId}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={bridge.hasToken ? "A token is saved in this browser" : "Paste the token"}
            className="focus-ring glass-input h-9 w-full rounded-[var(--glass-radius-md)] px-3 text-sm"
          />
        </div>
        <button type="submit" disabled={!draft.trim()} className={`${btn} glass-button-primary text-white`}>
          Save
        </button>
        <button type="button" onClick={forgetBridgeToken} disabled={!bridge.hasToken} className={btn}>
          Forget
        </button>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-300" role="status" data-testid="bridge-status" data-status={bridge.status}>
          {status}
        </p>
        <button type="button" onClick={() => void bridge.check()} disabled={!bridge.hasToken || bridge.checking} className={btn}>
          Check now
        </button>
      </div>
    </div>
  );
}
