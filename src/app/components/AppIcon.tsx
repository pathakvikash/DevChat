"use client";

import { useState } from "react";
import { appIconHref } from "@/lib/apps/ui";

/** App icon (via the /icon proxy) with a letter tile when there is no icon, no id yet (previews) or it fails to load. */
export function AppIcon({ app, size = 20 }: { app: { id?: string; name: string; icon?: string }; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (app.id && app.icon && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={appIconHref(app.id)} alt="" style={style} className="shrink-0 rounded-md object-cover" onError={() => setFailed(true)} />;
  }
  return (
    <span aria-hidden="true" style={{ ...style, fontSize: size * 0.5 }}
      className="shrink-0 flex items-center justify-center rounded-md bg-[var(--row-active)] font-semibold text-zinc-300">
      {app.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
