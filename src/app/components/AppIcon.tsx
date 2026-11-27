"use client";

import { useState } from "react";

/** App icon with a letter tile when there is no icon or it fails to load. */
export function AppIcon({ app, size = 20 }: { app: { name: string; icon?: string }; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (app.icon && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={app.icon} alt="" style={style} className="shrink-0 rounded-md object-cover" onError={() => setFailed(true)} />;
  }
  return (
    <span aria-hidden="true" style={{ ...style, fontSize: size * 0.5 }}
      className="shrink-0 flex items-center justify-center rounded-md bg-[var(--row-active)] font-semibold text-zinc-300">
      {app.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
