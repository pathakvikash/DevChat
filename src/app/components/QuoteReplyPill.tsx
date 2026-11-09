"use client";

import { useEffect, useState, type RefObject } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MessageSquarePlus, Mic, TextQuote } from "lucide-react";
import { isVoiceSupported } from "@/lib/useVoiceDictation";
import { trimQuote } from "@/lib/utils/quoteReply";

const PILL_HEIGHT = 32;
const GAP = 8;
const FLIP_ZONE = 48;
// Rough widths of the pill's parts, to keep it clear of the wrapper edges without measuring.
const WIDTH_REPLY = 72;
const WIDTH_SIDE = 140;
const WIDTH_MIC = 34;

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
  onQuote: (text: string, dictate?: boolean) => void;
  /** Start a side chat about the selection. Left out where none can open. */
  onSideChat?: (text: string) => void;
  /** Offer the mic. Off where no composer can take dictation (a side chat). */
  voice?: boolean;
  /** An overlay is open: keep the pill away. */
  suppressed?: boolean;
}

/** Pill (Start a side chat, Reply, mic) that appears over a selection made inside a single message (UX guide 3.1). */
export default function QuoteReplyPill({ containerRef, onQuote, onSideChat, voice = true, suppressed }: QuoteReplyPillProps) {
  const [pill, setPill] = useState<{ text: string; left: number; top: number } | null>(null);

  const mic = voice && isVoiceSupported();
  const halfWidth = (WIDTH_REPLY + (onSideChat ? WIDTH_SIDE : 0) + (mic ? WIDTH_MIC : 0)) / 2;

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
        left: Math.min(Math.max(sr.left + sr.width / 2 - hr.left, GAP + halfWidth), hr.width - GAP - halfWidth),
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
  }, [containerRef, halfWidth]);

  const btn = "focus-ring inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 hover:bg-[var(--glass-bg-hover)]";
  const divider = "h-4 w-px bg-[var(--glass-border-strong)]";
  // Run the action with the text captured at mouseup, then clear the selection and hide the pill.
  function act(run: () => void) {
    run();
    window.getSelection()?.removeAllRanges();
    setPill(null);
  }

  return (
    <AnimatePresence>
      {pill && !suppressed && (
        <div className="absolute z-20 -translate-x-1/2" style={{ left: pill.left, top: pill.top }}>
          <motion.div
            role="group"
            // Keep the selection alive through any click on the pill.
            onMouseDown={(e) => e.preventDefault()}
            aria-label="Selected text actions"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1, transition: { duration: 0.12 } }}
            exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.08 } }}
            className="inline-flex h-8 items-center rounded-full glass-panel-strong px-0.5 text-xs font-medium text-[var(--foreground)]"
          >
            {onSideChat && (
              <>
                <button
                  type="button"
                  aria-label="Start a side chat about the selected text"
                  title="Start a side chat"
                  onClick={() => act(() => onSideChat(pill.text))}
                  className={btn}
                >
                  <MessageSquarePlus size={14} />
                  Start a side chat
                </button>
                <span aria-hidden className={divider} />
              </>
            )}
            <button
              type="button"
              aria-label="Reply to selected text"
              title="Reply to selected text"
              onClick={() => act(() => onQuote(pill.text))}
              className={btn}
            >
              <TextQuote size={14} />
              Reply
            </button>
            {mic && (
              <>
                <span aria-hidden className={divider} />
                <button
                  type="button"
                  aria-label="Reply to selected text by voice"
                  title="Reply by voice"
                  onClick={() => act(() => onQuote(pill.text, true))}
                  className="focus-ring inline-flex h-7 w-8 items-center justify-center rounded-full hover:bg-[var(--glass-bg-hover)]"
                >
                  <Mic size={14} />
                </button>
              </>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
