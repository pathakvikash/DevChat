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
      className="focus-ring inline-flex items-center gap-1 rounded-[var(--glass-radius-sm)] glass-button px-2 py-1 text-xs text-zinc-400 transition hover:text-zinc-100"
    >
      {added ? <Check size={12} /> : <ArrowLeftRight size={12} />}
      {added ? "Added" : "Send to main"}
    </button>
  );
}
