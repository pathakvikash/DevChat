"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import SidePanel from "./ui/SidePanel";

interface ScratchpadProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId: string;
}

const DEBOUNCE_MS = 500;

export default function Scratchpad({
  isOpen,
  onClose,
  conversationId,
}: ScratchpadProps) {
  const [notes, setNotes] = useState("");
  const [loaded, setLoaded] = useState(false);
  const notesRef = useRef(notes);
  notesRef.current = notes;

  useEffect(() => {
    if (!isOpen || loaded) return;
    fetch(`/api/conversations/${conversationId}`)
      .then((r) => r.json())
      .then((conv) => {
        setNotes(conv.note ?? "");
        setLoaded(true);
      })
      .catch(console.error);
  }, [isOpen, conversationId, loaded]);

  useEffect(() => {
    if (!isOpen || !loaded) return;
    const timer = setTimeout(() => {
      fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: notes }),
      }).catch(console.error);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [notes, conversationId, isOpen, loaded]);

  useEffect(() => {
    if (!isOpen && loaded) {
      fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: notesRef.current }),
      }).catch(console.error);
    }
  }, [isOpen, conversationId, loaded]);

  useEffect(() => {
    if (isOpen) setLoaded(false);
  }, [conversationId, isOpen]);

  function handleClear() {
    setNotes("");
    fetch(`/api/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: "" }),
    }).catch(console.error);
  }

  return (
    <SidePanel
      isOpen={isOpen}
      onClose={onClose}
      title="Scratchpad Notes"
      subtitle="Free-form notes for this conversation"
    >
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Type your notes here..."
        className="w-full min-h-[50vh] glass-input rounded-[var(--glass-radius-md)] px-4 py-3 text-sm resize-y"
        spellCheck={false}
      />
      <button
        onClick={handleClear}
        className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-400 hover:text-red-400 glass-button rounded-[var(--glass-radius-md)] transition"
      >
        <Trash2 size={14} />
        Clear
      </button>
    </SidePanel>
  );
}
