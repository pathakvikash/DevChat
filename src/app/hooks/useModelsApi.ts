"use client";

import type { ModelInfo } from "@/app/components/conversation/types";

export interface ModelUsage {
  usage: Record<string, number>;
}

export async function fetchModels(): Promise<ModelInfo[]> {
  const res = await fetch("/api/models");
  if (!res.ok) throw new Error("Failed to fetch models");
  const data = await res.json();
  return data.models || [];
}

export async function fetchModelUsage(): Promise<ModelUsage> {
  const res = await fetch("/api/models/usage");
  if (!res.ok) return { usage: {} };
  return res.json();
}
