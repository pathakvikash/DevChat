"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
import { ArrowLeftRight, PanelLeft, PanelRight } from "lucide-react";

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface DropZone {
  key: string;
  kind: "insert" | "replace" | "focus" | "busy";
  index: number;
  side: "left" | "right";
  paneId: string;
  rect: Rect;
  label: string;
  disabled: boolean;
}

interface DropOverlayProps {
  rowRef: RefObject<HTMLDivElement | null>;
  ids: string[];
  dragId: string;
  limit: number;
  titleOf: (id: string) => string;
  isBusy: (id: string) => boolean;
  onDrop: (zone: { kind: DropZone["kind"]; index: number; side: "left" | "right"; paneId: string }, chatId: string) => void;
}

const INSET = 8;

/** Drop targets over the panes row, shown while a sidebar chat is dragged. */
export default function DropOverlay({ rowRef, ids, dragId, limit, titleOf, isBusy, onDrop }: DropOverlayProps) {
  const [zones, setZones] = useState<DropZone[]>([]);
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const base = row.getBoundingClientRect();
    const panes = ids.flatMap((id, index) => {
      const el = row.querySelector<HTMLElement>(`[data-pane-id="${id}"]`);
      if (!el) return [];
      const r = el.getBoundingClientRect();
      return [{ id, index, rect: { left: r.left - base.left, top: r.top - base.top, width: r.width, height: r.height } }];
    });
    const next: DropZone[] = [];
    if (ids.includes(dragId)) {
      next.push({
        key: "focus",
        kind: "focus",
        index: ids.indexOf(dragId),
        side: "right",
        paneId: dragId,
        rect: { left: 0, top: 0, width: base.width, height: base.height },
        label: "Already open",
        disabled: false,
      });
    } else if (ids.length < limit) {
      for (const p of panes) {
        const half = p.rect.width / 2;
        next.push({ key: `${p.id}-l`, kind: "insert", index: p.index, side: "left", paneId: p.id, rect: { ...p.rect, width: half }, label: "Open on the left", disabled: false });
        next.push({ key: `${p.id}-r`, kind: "insert", index: p.index, side: "right", paneId: p.id, rect: { ...p.rect, left: p.rect.left + half, width: half }, label: "Open on the right", disabled: false });
      }
    } else {
      for (const p of panes) {
        const busy = isBusy(p.id);
        next.push({
          key: p.id,
          kind: busy ? "busy" : "replace",
          index: p.index,
          side: "right",
          paneId: p.id,
          rect: p.rect,
          label: busy ? "Busy: replying or has a draft" : `Replace "${titleOf(p.id)}"`,
          disabled: busy,
        });
      }
    }
    setZones(next);
    // Zones are measured once when the drag starts; pane sizes do not change during a drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragId]);

  function zoneAt(clientX: number, clientY: number): DropZone | undefined {
    const row = rowRef.current;
    if (!row) return undefined;
    const base = row.getBoundingClientRect();
    const x = clientX - base.left;
    const y = clientY - base.top;
    return zones.find((z) => x >= z.rect.left && x < z.rect.left + z.rect.width && y >= z.rect.top && y < z.rect.top + z.rect.height);
  }

  const hovered = zones.find((z) => z.key === hoverKey);
  const focusZone = zones.find((z) => z.kind === "focus");
  const labelZone = hovered ?? focusZone;
  const allBlocked = zones.length > 0 && zones.every((z) => z.disabled);
  const Icon = labelZone?.kind === "insert" ? (labelZone.side === "left" ? PanelLeft : PanelRight) : ArrowLeftRight;

  return (
    <div
      className="absolute inset-0 z-30"
      onDragOver={(e) => {
        e.preventDefault();
        const z = zoneAt(e.clientX, e.clientY);
        setHoverKey(z?.key ?? null);
        e.dataTransfer.dropEffect = z && !z.disabled ? "move" : "none";
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHoverKey(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        const z = zoneAt(e.clientX, e.clientY);
        if (z && !z.disabled) onDrop(z, dragId);
        setHoverKey(null);
      }}
    >
      {zones.map((z) => (
        <div
          key={z.key}
          aria-hidden
          className={`absolute rounded-[var(--glass-radius-lg)] border-2 border-dashed transition-colors duration-100 ${
            z.key === hoverKey && !z.disabled
              ? "border-[var(--glass-accent-strong)] bg-[var(--glass-bg-active)] shadow-[var(--glass-shadow-glow)]"
              : "border-[var(--glass-border-strong)] bg-[var(--glass-bg)]"
          } ${z.disabled ? "opacity-50" : ""}`}
          style={{
            left: z.rect.left + INSET,
            top: z.rect.top + INSET,
            width: Math.max(0, z.rect.width - 2 * INSET),
            height: Math.max(0, z.rect.height - 2 * INSET),
          }}
        />
      ))}
      {labelZone && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: labelZone.rect.left + labelZone.rect.width / 2, top: labelZone.rect.top + labelZone.rect.height / 2 }}
        >
          <span className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full glass-panel-strong px-3 text-xs font-medium text-[var(--foreground)]">
            {labelZone.kind === "insert" || labelZone.kind === "replace" ? <Icon size={14} /> : null}
            {labelZone.label}
          </span>
        </div>
      )}
      {allBlocked && !hovered && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="inline-flex h-8 items-center rounded-full glass-panel-strong px-3 text-xs font-medium text-[var(--foreground)]">
            Close a pane first. Up to {limit} fit at this width.
          </span>
        </div>
      )}
    </div>
  );
}
