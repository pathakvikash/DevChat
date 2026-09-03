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

export interface ProviderStatusInfo {
  id: string;
  label: string;
  configured: boolean;
  modelCount: number;
  error?: string;
  kind?: "cli";
}

/** Models plus per-provider availability, for the Settings page. */
export async function fetchModelCatalog(): Promise<{
  models: ModelInfo[];
  providers: ProviderStatusInfo[];
}> {
  const res = await fetch("/api/models");
  if (!res.ok) throw new Error("Failed to fetch models");
  const data = await res.json();
  return { models: data.models || [], providers: data.providers || [] };
}
