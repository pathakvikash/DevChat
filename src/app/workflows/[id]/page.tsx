"use client";

import { Suspense, use } from "react";
import WorkflowEditor from "../components/WorkflowEditor";

export default function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={null}>
      <WorkflowEditor id={id} />
    </Suspense>
  );
}
