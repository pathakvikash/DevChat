"use client";
import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { Download, ExternalLink } from "lucide-react";
import { goHref, modelUrl } from "@/lib/generativeUi/appData";

// Lazy + client-only: three.js stays out of the main bundle.
const Inner = dynamic(() => import("./Model3DInner"), {
  ssr: false,
  loading: () => <div className="w-full h-72 rounded-[var(--glass-radius-sm)] glass flex items-center justify-center text-xs text-zinc-400">Loading 3D viewer…</div>,
});

interface Props {
  appId?: string | null;
  file?: string | null;
  url?: string | null;
  title?: string | null;
  /** Deep-link name from the app manifest for an "Open in {app}" button. */
  openLink?: string | null;
  appName?: string | null;
}

const linkCls = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--glass-radius-md)] text-sm glass-button text-zinc-300 focus-visible:outline-2 focus-visible:outline-blue-500";

export default function Model3D({ appId, file, url, title, openLink, appName }: Props) {
  const src = modelUrl({ appId, file, url });
  const [fallback, setFallback] = useState<string | null>(null);
  const onFallback = useCallback((r: string) => setFallback(r), []);
  const open = appId && openLink ? goHref(appId, openLink, file ? { file } : null) : null;

  if (!src) return <p className="text-xs text-zinc-400">This 3D model has no valid file.</p>;
  return (
    <div className="my-2 min-w-0 space-y-2">
      {title && <p className="text-sm font-semibold text-zinc-100">{title}</p>}
      {fallback ? (
        <p className="text-xs text-zinc-400">{fallback} Download the STL to open it in your own viewer.</p>
      ) : (
        <Inner url={src} onFallback={onFallback} />
      )}
      <div className="flex flex-wrap gap-2">
        <a href={src} download={file || "model.stl"} className={linkCls}>
          <Download size={14} aria-hidden /> Download STL
        </a>
        {open && (
          <a href={open} target="_blank" rel="noopener noreferrer" className={linkCls}>
            <ExternalLink size={14} aria-hidden /> Open in {appName || appId}
          </a>
        )}
      </div>
    </div>
  );
}
