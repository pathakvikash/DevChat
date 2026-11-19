"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSplitViewOptional } from "@/app/c/SplitViewContext";
import { PANEL_VIEWS, panelHref, parsePanel, type PanelState, type PanelView } from "@/lib/chatPanel";

const LAST_KEY = "vas:panel:last";

function readLast(): PanelView {
  try {
    const v = localStorage.getItem(LAST_KEY);
    if (PANEL_VIEWS.includes(v as PanelView)) return v as PanelView;
  } catch {
    // The last view is a convenience.
  }
  return "outputs";
}

/** The docked panel's state lives in the URL (`?panel=`); this reads and writes it for one chat's pane. */
export function usePanel(conversationId: string) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const split = useSplitViewOptional();
  const state = parsePanel(params, split?.ids ?? [conversationId]);
  /** The panel as this pane shows it: only the owner chat's pane renders one. */
  const mine: PanelState | null = state && state.owner === conversationId ? state : null;

  const open = useCallback(
    (view: PanelView, item?: string | null) => {
      try {
        localStorage.setItem(LAST_KEY, view);
      } catch {
        // Not remembered in this browser.
      }
      // window.location is the freshest copy: a focus change writes with replaceState between renders.
      router.replace(panelHref(pathname, new URLSearchParams(window.location.search), { view, item, owner: conversationId }), { scroll: false });
    },
    [router, pathname, conversationId],
  );

  const close = useCallback(() => {
    router.replace(panelHref(pathname, new URLSearchParams(window.location.search), null), { scroll: false });
  }, [router, pathname]);

  const toggle = useCallback(() => (mine ? close() : open(readLast())), [mine, close, open]);

  return { panel: mine, open, close, toggle };
}
