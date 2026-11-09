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
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/integrations/google").catch(() => null);
    setFailed(!res?.ok);
    setState(res?.ok ? await res.json() : null);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads once on mount
    void load();
    if (compact) return;
    const flag = new URLSearchParams(window.location.search).get("google");
    if (flag === "denied" || flag === "failed") toast("Google wasn't connected. Try again.", "error");
    if (flag === "scope") toast("Google didn't give DevChat access to the sheets it creates. Try again and keep that box ticked.", "error");
    if (flag === "not-configured") toast("Google isn't set up on this server.", "error");
    // The flag has been shown: take it out of the address so a reload does not repeat it.
    if (flag) {
      const q = new URLSearchParams(window.location.search);
      q.delete("google");
      window.history.replaceState(null, "", `${window.location.pathname}${q.size ? `?${q}` : ""}`);
    }
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
  let text = failed ? "Couldn't check the Google connection." : "Checking Google…";
  let action: React.ReactNode = failed ? <a href={connectHref(returnTo)} className={link}>Connect Google</a> : null;
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
