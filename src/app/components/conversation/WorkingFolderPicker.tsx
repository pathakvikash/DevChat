"use client";

import { useState } from "react";
import { FolderOpen } from "lucide-react";
import { shortenHome, useFolders } from "@/app/hooks/useFolders";
import FolderBrowserDialog from "./FolderBrowserDialog";

interface WorkingFolderPickerProps {
  value: string | null;
  onChange: (folder: string | null) => void;
  disabled?: boolean;
  /** Accessible name; defaults to "Working folder". */
  label?: string;
  /** Tooltip that replaces the default one (for example in a workflow card). */
  hint?: string;
  /** Replaces the outer label's classes, e.g. a full-width input look. */
  className?: string;
}

const CHOOSE = "__choose__"; // sentinel option: opens the browser, never becomes the value

/** Folder a model may read in (and edit in, for Agent mode), chosen from the user's folder list.
 *  The model settings dialog carries the same control. */
export default function WorkingFolderPicker({ value, onChange, disabled, label, hint, className }: WorkingFolderPickerProps) {
  const { folders, hostTools, reason, loaded, error, refetch } = useFolders();
  const [browsing, setBrowsing] = useState(false);
  const short = shortenHome;

  const known = loaded && !error;
  if (known && !hostTools && !value) return null;
  const listed = folders.some((p) => p.path === value);
  const stale = known && hostTools && !!value && !listed;
  const canChoose = !known || hostTools;

  const defaultTitle = value
    ? `Working folder: ${value}. Type @ to mention a file.`
    : "No working folder: the tool can't see any files";
  const staleTitle = `${value && short(value)} isn't one of your folders any more. Add it again with Choose folder…, or pick another.`;

  return (
    <>
      <label
        className={
          className ??
          "flex h-8 items-center gap-1.5 rounded-[var(--glass-radius-md)] glass-button px-2 text-xs text-zinc-300"
        }
        title={reason ?? (stale ? staleTitle : (hint ?? defaultTitle))}
      >
        <FolderOpen size={13} className={`shrink-0 ${stale ? "text-amber-400" : value ? "text-emerald-400" : "text-zinc-500"}`} />
        <select
          aria-label={label ?? "Working folder"}
          data-folder-picker
          value={value ?? ""}
          onChange={(e) => {
            if (e.target.value === CHOOSE) {
              e.target.focus(); // so the dialog can hand focus back here when it closes
              setBrowsing(true);
            }
            else onChange(e.target.value || null);
          }}
          disabled={disabled}
          className={`min-w-0 truncate bg-transparent outline-none disabled:opacity-50 ${className ? "flex-1" : "max-w-[10rem]"}`}
        >
          <option value="">No folder</option>
          {hostTools && folders.map((p) => (
            <option key={p.path} value={p.path}>
              {short(p.path)}
            </option>
          ))}
          {value && !(hostTools && listed) && <option value={value}>{short(value)}{stale ? " (removed)" : ""}</option>}
          {canChoose && (
            <>
              <hr />
              <option value={CHOOSE} disabled={!!reason}>
                Choose folder…
              </option>
            </>
          )}
        </select>
      </label>
      <FolderBrowserDialog
        isOpen={browsing}
        onClose={() => setBrowsing(false)}
        onPicked={async (path) => {
          await refetch();
          onChange(path);
        }}
      />
    </>
  );
}
