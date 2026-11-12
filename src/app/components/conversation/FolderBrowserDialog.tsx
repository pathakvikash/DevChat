"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ArrowUp, Folder, X } from "lucide-react";
import CenteredDialog from "@/app/components/ui/CenteredDialog";

interface Browse {
  path: string;
  parent: string | null;
  dirs: { name: string; path: string }[];
  truncated: boolean;
}

type Outcome<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(url: string, init?: RequestInit): Promise<Outcome<T>> {
  try {
    const res = await fetch(url, init);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json.error || "Something went wrong. Try again." };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Try again." };
  }
}

const browse = (path: string | null, hidden: boolean) =>
  call<Browse>(`/api/folders/browse?${new URLSearchParams({ ...(path ? { path } : {}), ...(hidden ? { hidden: "1" } : {}) })}`);

interface FolderBrowserDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the real path once the server has added the folder. The dialog then closes itself. */
  onPicked: (path: string) => void;
}

/** Portal: callers sit inside glass panels, and backdrop-filter would trap a fixed overlay in them. */
export default function FolderBrowserDialog({ isOpen, onClose, onPicked }: FolderBrowserDialogProps) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <CenteredDialog isOpen={isOpen} onClose={onClose} widthClass="max-w-lg mx-3" paddingClass="p-4 sm:p-6">
      <Body onClose={onClose} onPicked={onPicked} />
    </CenteredDialog>,
    document.body,
  );
}

// Mounted only while the dialog is open, so every opening starts fresh at the default folder.
function Body({ onClose, onPicked }: Omit<FolderBrowserDialogProps, "isOpen">) {
  const titleId = useId();
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<Browse | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0); // ignores a slow answer that arrives after a newer click

  function show(r: Outcome<Browse>, focus = true) {
    setLoading(false);
    if (r.ok) {
      setData(r.data);
      setPathInput(r.data.path);
      setError(null);
      if (focus) inputRef.current?.focus(); // the clicked row is gone; don't drop focus to <body>
    } else setError(r.error);
  }

  async function go(path: string | null, h = hidden, focus = true) {
    const mine = ++latest.current;
    setLoading(true);
    const r = await browse(path, h);
    if (mine === latest.current) show(r, focus);
  }

  useEffect(() => {
    const mine = ++latest.current;
    void browse(null, false).then((r) => mine === latest.current && show(r));
  }, []);

  // Capture phase: Escape must not also reach the chat's shortcuts or the panel under this dialog.
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onEsc, true);
    return () => document.removeEventListener("keydown", onEsc, true);
  }, [onClose]);

  useEffect(() => () => opener?.focus(), [opener]);

  function trapTab(e: React.KeyboardEvent) {
    if (e.key !== "Tab") return;
    const items = rootRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input");
    if (!items?.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  async function choose() {
    const typed = pathInput.trim();
    setAdding(true);
    let path = data?.path;
    if (typed && typed !== path) {
      // Add what the screen shows: browse to the typed path first, then add its real path.
      const mine = ++latest.current;
      const b = await browse(typed, hidden);
      if (mine !== latest.current) return setAdding(false);
      show(b);
      if (!b.ok) return setAdding(false);
      path = b.data.path;
    }
    if (!path) return setAdding(false);
    const r = await call<{ folder: { path: string } }>("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    setAdding(false);
    if (!r.ok) return setError(r.error);
    onPicked(r.data.folder.path);
    onClose();
  }

  const crumbs = data ? data.path.split("/").filter(Boolean) : [];
  const crumbPath = (i: number) => "/" + crumbs.slice(0, i + 1).join("/");
  const busy = loading || adding;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        e.stopPropagation(); // no other key may reach the shortcuts under the dialog
        trapTab(e);
      }}
      className="space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id={titleId} className="text-lg font-semibold text-[var(--foreground)]">
          Choose a folder
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          title="Close"
          className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center glass-button rounded-[var(--glass-radius-md)] text-zinc-400"
        >
          <X size={16} />
        </button>
      </div>

      <input
        ref={inputRef}
        aria-label="Folder path"
        autoFocus
        spellCheck={false}
        value={pathInput}
        onChange={(e) => setPathInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void go(pathInput.trim() || null);
          }
        }}
        placeholder="Paste a path, then press Enter"
        className="w-full glass-input rounded-[var(--glass-radius-md)] px-3 py-2 font-mono text-sm"
      />

      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => data?.parent && void go(data.parent)}
          disabled={!data?.parent}
          aria-label="Parent folder"
          title="Parent folder"
          className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center glass-button rounded-[var(--glass-radius-md)] text-zinc-400 disabled:opacity-50"
        >
          <ArrowUp size={16} />
        </button>
        <nav aria-label="Breadcrumb" className="flex min-h-8 min-w-0 flex-wrap items-center">
          {data && (
            <>
              <button type="button" onClick={() => void go("/")} aria-current={crumbs.length === 0 ? "page" : undefined} className="focus-ring h-8 px-1 text-xs text-zinc-400 hover:text-zinc-200">
                /
              </button>
              {crumbs.map((c, i) => (
                <span key={crumbPath(i)} className="flex items-center">
                  {i > 0 && <span aria-hidden className="text-xs text-zinc-400">/</span>}
                  <button
                    type="button"
                    onClick={() => void go(crumbPath(i))}
                    aria-current={i === crumbs.length - 1 ? "page" : undefined}
                    className="focus-ring h-8 max-w-[10rem] truncate px-1 text-xs text-zinc-400 hover:text-zinc-200 aria-[current=page]:text-zinc-200"
                  >
                    {c}
                  </button>
                </span>
              ))}
            </>
          )}
        </nav>
      </div>

      <ul role="list" aria-label="Sub-folders" className="max-h-72 overflow-y-auto">
        {data?.dirs.map((d) => (
          <li key={d.path}>
            <button
              type="button"
              onClick={() => void go(d.path)}
              className="focus-ring flex h-8 w-full items-center gap-2 rounded-[var(--glass-radius-sm)] px-2 text-left hover:bg-[var(--glass-bg-hover)]"
            >
              <Folder size={14} className="shrink-0 text-zinc-400" />
              <span className="truncate text-sm text-zinc-200">{d.name}</span>
            </button>
          </li>
        ))}
      </ul>

      <p role="status" aria-live="polite" className="flex min-h-5 items-start gap-1.5 text-xs text-zinc-400">
        {error ? (
          <>
            <AlertTriangle size={14} className="mt-px shrink-0 text-red-400" />
            <span className="min-w-0 break-words text-zinc-300">{error}</span>
          </>
        ) : loading ? (
          "Loading…"
        ) : data && data.dirs.length === 0 ? (
          "No sub-folders here."
        ) : data?.truncated ? (
          "Showing the first 500. Paste a path to go further."
        ) : null}
      </p>

      <label className="flex w-fit items-center gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={hidden}
          onChange={(e) => {
            setHidden(e.target.checked);
            void go(data?.path ?? null, e.target.checked, false);
          }}
          className="h-4 w-4"
        />
        Show hidden folders
      </label>

      <div className="flex justify-end gap-3">
        <button type="button" onClick={onClose} className="focus-ring h-8 px-3 text-sm font-medium text-zinc-300 glass-button rounded-[var(--glass-radius-md)]">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void choose()}
          disabled={busy}
          className="focus-ring h-8 px-3 text-sm font-medium glass-button-primary text-white rounded-[var(--glass-radius-md)] disabled:opacity-50"
        >
          Use this folder
        </button>
      </div>
    </div>
  );
}
