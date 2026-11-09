"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useToast } from "@/app/components/Toast";

interface State {
  configured: boolean;
  connected: boolean;
  reconnect: boolean;
}

export const connectHref = (returnTo: string) => `/api/integrations/google/connect?returnTo=${encodeURIComponent(returnTo)}`;

/** The user's Google (Sheets) connection: its state, and Connect / Reconnect / Disconnect. `compact` is the one-line version for a card's settings. */
export default function GoogleConnection({ compact = false, returnTo = "/settings" }: { compact?: boolean; returnTo?: string }) {
  const { toast } = useToast();
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/integrations/google").catch(() => null);
    setState(res?.ok ? await res.json() : null);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads once on mount
    void load();
    if (compact) return;
    const flag = new URLSearchParams(window.location.search).get("google");
    if (flag === "denied" || flag === "failed") toast("Google wasn't connected. Try again.", "error");
    if (flag === "not-configured") toast("Google isn't set up on this server.", "error");
  }, [load, compact, toast]);

  async function disconnect() {
    setBusy(true);
    const res = await fetch("/api/integrations/google", { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return toast("Couldn't disconnect Google. Try again.", "error");
    await load();
    toast("Google disconnected. Your sheets stay in Google Drive.", "success");
  }

  const link = "focus-ring glass-button-primary inline-flex h-9 items-center rounded-[var(--glass-radius-md)] px-4 text-sm font-medium text-white";
  let text = "Checking Google…";
  let action: React.ReactNode = null;
  if (state) {
    if (!state.configured) text = "Google isn't set up on this server, so sheets can't be synced.";
    else if (state.connected) {
      text = "Google is connected. DevChat can only open the sheets it creates.";
      action = (
        <button type="button" onClick={disconnect} disabled={busy} className="focus-ring glass-button h-9 rounded-[var(--glass-radius-md)] px-4 text-sm font-medium">
          Disconnect
        </button>
      );
    } else if (state.reconnect) {
      text = "Google access ended.";
      action = <a href={connectHref(returnTo)} className={link}>Reconnect Google</a>;
    } else {
      text = "Google isn't connected.";
      action = <a href={connectHref(returnTo)} className={link}>Connect Google</a>;
    }
  }

  if (compact) {
    return (
      <p className="text-xs text-zinc-300" data-testid="google-status">
        {text}{" "}
        {state?.configured && !state.connected && (
          <Link href="/settings" className="focus-ring underline">
            {state.reconnect ? "Reconnect in Settings" : "Connect in Settings"}
          </Link>
        )}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-zinc-400" role="status">{text}</p>
      {action}
    </div>
  );
}
