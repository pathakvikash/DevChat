/** The chat page's right-hand panel lives in the URL: `?panel=<view>&item=<id>&panelOf=<chatId>`. Pure, no React. */

export const PANEL_VIEWS = ["context", "outputs", "tasks", "connectors", "files", "notes", "todos"] as const;
export type PanelView = (typeof PANEL_VIEWS)[number];

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface PanelState {
  view: PanelView;
  /** An artifact id or a sub-agent chat id; never a file path. */
  item: string | null;
  /** The chat whose pane holds the panel. */
  owner: string;
}

/** `ids` are the open chats (first one is the path's). Unknown views, bad ids and absent owners give null. */
export function parsePanel(params: URLSearchParams, ids: string[]): PanelState | null {
  const view = params.get("panel");
  if (!ids.length || !PANEL_VIEWS.includes(view as PanelView)) return null;
  const item = params.get("item");
  const wanted = params.get("panelOf") ?? "";
  return {
    view: view as PanelView,
    item: item && ID_PATTERN.test(item) ? item : null,
    owner: ids.includes(wanted) ? wanted : ids[0],
  };
}

/** The URL with the panel set (or removed when `next` is null); every other param is kept. `panelOf` is written only for a pane that is not the first. */
export function panelHref(
  pathname: string,
  params: URLSearchParams,
  next: { view: PanelView; item?: string | null; owner?: string } | null,
): string {
  const q = new URLSearchParams(params.toString());
  for (const key of ["panel", "item", "panelOf"]) q.delete(key);
  if (next) {
    q.set("panel", next.view);
    if (next.item && ID_PATTERN.test(next.item)) q.set("item", next.item);
    const first = /^\/c\/([^/?#]+)$/.exec(pathname)?.[1];
    if (next.owner && next.owner !== first) q.set("panelOf", next.owner);
  }
  const qs = q.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
