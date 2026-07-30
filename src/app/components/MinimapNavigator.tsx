"use client";

import { memo, useRef, useState, useEffect } from "react";

export interface MinimapMessage {
  id: string;
  role: "user" | "assistant" | "system" | "compression";
  preview: string;
}

interface MinimapNavigatorProps {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  messages: MinimapMessage[];
}

function MinimapNavigatorInner({
  scrollRef,
  messages,
}: MinimapNavigatorProps) {
  const userMessages = messages.filter((m) => m.role === "user");
  const [showPopup, setShowPopup] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);
  const activeIndexRef = useRef(0);
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || messages.length === 0) return;

    const scrollEl = el;
    function observeAllItems(obs: IntersectionObserver) {
      scrollEl.querySelectorAll<HTMLElement>("[data-message-id]")
        .forEach((item) => obs.observe(item));
    }

    const observer = new IntersectionObserver(
      (entries) => {
        observeAllItems(observer);
        let best = activeIndexRef.current;
        let bestRatio = 0;
        for (const entry of entries) {
          const idx = parseInt(
            (entry.target as HTMLElement).dataset.messageIndex || "",
            10,
          );
          if (!isNaN(idx) && entry.intersectionRatio > bestRatio) {
            bestRatio = entry.intersectionRatio;
            best = idx;
          }
        }
        if (best !== activeIndexRef.current) {
          activeIndexRef.current = best;
          setActiveIndex(best);
        }
      },
      {
        root: el,
        rootMargin: "-20% 0px -20% 0px",
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    );

    observeAllItems(observer);

    const mo = new MutationObserver(() => observeAllItems(observer));
    mo.observe(el, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mo.disconnect();
    };
  }, [messages.length]);

  if (userMessages.length === 0) return null;

  function scrollToMessage(index: number) {
    const items = scrollRef.current?.querySelectorAll<HTMLElement>("[data-message-id]");
    if (!items || !items[index]) return;
    items[index].scrollIntoView({ behavior: "instant", block: "center" });
    activeIndexRef.current = index;
    setActiveIndex(index);
    setShowPopup(false);
  }

  function handlePopupMouseEnter() {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setShowPopup(true);
  }

  function handlePopupMouseLeave() {
    hoverTimeoutRef.current = setTimeout(() => setShowPopup(false), 200);
  }

  return (
    <div
      className="hidden md:flex flex-col w-[28px] shrink-0 relative justify-center mr-[50px]"
      onMouseEnter={handlePopupMouseEnter}
      onMouseLeave={handlePopupMouseLeave}
    >
      <div className="flex flex-col items-center justify-center w-full gap-[4px]">
        {messages.map((msg, i) => {
          if (msg.role !== "user") return null;
          const isActive = i === activeIndex;

          return (
            <div
              key={msg.id}
              className="cursor-pointer flex items-center justify-center"
              onClick={() => scrollToMessage(i)}
            >
              <div
                className={`rounded transition-all duration-200 ${
                  isActive ? "bg-white" : "bg-zinc-600"
                }`}
                style={{ width: isActive ? "20px" : "14px", height: "4px" }}
              />
            </div>
          );
        })}
      </div>

      {showPopup && (
        <div
          className="absolute right-full mr-3 z-50 top-1/2 -translate-y-1/2"
          onMouseEnter={handlePopupMouseEnter}
          onMouseLeave={handlePopupMouseLeave}
        >
          <div className="glass-panel rounded-[var(--glass-radius-md)] shadow-xl max-h-[70vh] overflow-y-auto w-64">
            <div className="px-3 py-2 text-xs text-zinc-500 border-b border-[var(--glass-border)] font-medium">
              Messages ({userMessages.length})
            </div>
            {messages.map((msg, i) => (
              msg.role === "user" ? (
                <button
                  key={msg.id}
                  onClick={() => scrollToMessage(i)}
                  className={`w-full text-left px-3 py-2 text-xs transition flex items-center gap-2 ${
                    i === activeIndex
                      ? "bg-[var(--glass-bg-hover)] text-white"
                      : "text-zinc-300 hover:bg-[var(--glass-bg-hover)]"
                  }`}
                >
                  <span className="shrink-0 font-medium text-blue-400">You</span>
                  <span className="text-zinc-400 mx-0.5">·</span>
                  <span className="truncate text-zinc-400">{msg.preview}</span>
                </button>
              ) : null
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const MinimapNavigator = memo(MinimapNavigatorInner, (prev, next) => {
  if (prev.messages.length !== next.messages.length) return false;
  for (let i = 0; i < prev.messages.length; i++) {
    if (prev.messages[i].id !== next.messages[i].id) return false;
  }
  return true;
});

export default MinimapNavigator;
