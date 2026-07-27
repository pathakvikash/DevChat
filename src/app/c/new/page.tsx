"use client";

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function NewConversationInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    async function createAndRedirect() {
      try {
        const savedModel = typeof window !== "undefined"
          ? localStorage.getItem("vas:settings:default_model")
          : null;
        const res = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "New Chat",
            model: savedModel || undefined,
          }),
        });
        if (!res.ok) return;
        const conv = await res.json();
        const q = searchParams.get("q");
        router.push(q ? `/c/${conv.id}?q=${encodeURIComponent(q)}` : `/c/${conv.id}`);
      } catch (error) {
        console.error("Failed to create conversation:", error);
      }
    }

    createAndRedirect();
  }, [router, searchParams]);

  return (
    <div className="flex h-screen items-center justify-center" style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}>
      Creating new conversation...
    </div>
  );
}

export default function NewConversationPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center" style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}>
        Loading...
      </div>
    }>
      <NewConversationInner />
    </Suspense>
  );
}
