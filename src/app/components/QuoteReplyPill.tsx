"use client";

import { useEffect, useState, type RefObject } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { TextQuote } from "lucide-react";
import { trimQuote } from "@/lib/utils/quoteReply";

const PILL_HEIGHT = 32;
const GAP = 8;
const FLIP_ZONE = 48;
// Half the pill's width, to keep it clear of the wrapper edges without measuring.
const HALF_WIDTH = 44;

function messageOf(node: Node | null): Element | null {
  const el = node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : (node?.parentElement ?? null);
  return el?.closest("[data-message-id]") ?? null;
}

// A triple-click ends at offset 0 of the next block; step back so it counts as the block it selected.
function lastSelectedNode(range: Range): Node {
  if (range.endOffset > 0) return range.endContainer;
  const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
  walker.currentNode = range.endContainer;
  return walker.previousNode() ?? range.endContainer;
}

interface QuoteReplyPillProps {
  /** The transcript's scroll element. Its offset parent (the `relative` wrapper) positions the pill. */
  containerRef: RefObject<HTMLElement | null>;
  onQuote: (text: string) => void;
  /** An overlay is open: keep the pill away. */
  suppressed?: boolean;
}

/** "Reply" pill that appears over a selection made inside a single message (UX guide 3.1). */
export default function QuoteReplyPill({ containerRef, onQuote, suppressed }: QuoteReplyPillProps) {
  const [pill, setPill] = useState<{ text: string; left: number; top: number } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const host = container?.offsetParent;
    if (!container || !host) return;
    const hide = () => setPill(null);

    function capture() {
      const sel = window.getSelection();
      const text = sel && trimQuote(sel.toString());
      if (!sel || sel.isCollapsed || !text) return hide();
      const range = sel.getRangeAt(0);
      const message = messageOf(range.startContainer);
      if (!message || message !== messageOf(lastSelectedNode(range)) || !container!.contains(message)) {
        return hide();
      }
      const sr = range.getBoundingClientRect();
      const hr = host!.getBoundingClientRect();
      const above = sr.top - hr.top - GAP - PILL_HEIGHT;
      // Below the selection near the top edge, and on touch so it clears the native copy menu.
      const below = above < FLIP_ZONE || window.matchMedia("(pointer: coarse)").matches;
      setPill({
        text,
        left: Math.min(Math.max(sr.left + sr.width / 2 - hr.left, GAP + HALF_WIDTH), hr.width - GAP - HALF_WIDTH),
        top: below ? sr.bottom - hr.top + GAP : above,
      });
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === "Escape") hide();
      else capture();
    }
    // On touch there is no mouseup, so show the pill once the selection handles stop moving.
    let settle: number | undefined;
    function onSelectionChange() {
      window.clearTimeout(settle);
      if (window.getSelection()?.isCollapsed) hide();
      else if (window.matchMedia("(pointer: coarse)").matches) settle = window.setTimeout(capture, 350);
    }

    // Wait for mouseup so the pill never shows mid-drag.
    document.addEventListener("mouseup", capture);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("selectionchange", onSelectionChange);
    container.addEventListener("scroll", hide, { passive: true });
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("mouseup", capture);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("selectionchange", onSelectionChange);
      window.clearTimeout(settle);
      container.removeEventListener("scroll", hide);
      window.removeEventListener("resize", hide);
    };
  }, [containerRef]);

  return (
    <AnimatePresence>
      {pill && !suppressed && (
        <div className="absolute z-20 -translate-x-1/2" style={{ left: pill.left, top: pill.top }}>
          <motion.button
            type="button"
            aria-label="Reply to selected text"
            title="Reply to selected text"
            // Keep the selection alive through the click.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onQuote(pill.text);
              window.getSelection()?.removeAllRanges();
              setPill(null);
            }}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1, transition: { duration: 0.12 } }}
            exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.08 } }}
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-full glass-panel-strong px-3 text-xs font-medium text-[var(--foreground)]"
          >
            <TextQuote size={14} />
            Reply
          </motion.button>
        </div>
      )}
    </AnimatePresence>
  );
}
