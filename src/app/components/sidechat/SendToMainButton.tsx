"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Check } from "lucide-react";

interface SendToMainButtonProps {
  /** The side reply's text. Only prefills the main input; nothing is sent. */
  text: string;
  parentTitle: string;
  onSendToMain: (text: string) => void;
}

export default function SendToMainButton({ text, parentTitle, onSendToMain }: SendToMainButtonProps) {
  const [added, setAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function handleClick() {
    onSendToMain(text);
    setAdded(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setAdded(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={`Add to the message box of "${parentTitle}"`}
      className="focus-ring inline-flex h-7 items-center gap-1 rounded-[var(--glass-radius-sm)] px-2 text-xs text-zinc-500 transition hover:bg-[var(--glass-bg-hover)] hover:text-zinc-200"
    >
      {added ? <Check size={16} /> : <ArrowLeftRight size={16} />}
      {added ? "Added" : "Send to main"}
    </button>
  );
}
