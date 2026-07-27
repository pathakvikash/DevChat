"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import ConversationLayout from "./ConversationLayout";

function ConversationPageInner() {
  const params = useParams();
  const searchParams = useSearchParams();
  const initialPrompt = searchParams.get("q") || undefined;
  return (
    <ConversationLayout
      key={params.id as string}
      conversationId={params.id as string}
      initialPrompt={initialPrompt}
    />
  );
}

export default function ConversationPage() {
  return (
    <Suspense fallback={null}>
      <ConversationPageInner />
    </Suspense>
  );
}
