"use client";

import type { ModelInfo } from "@/app/components/conversation/types";

export interface ModelUsage {
  usage: Record<string, number>;
}

// The ids of the last good answer, so a chat send does not re-list every provider (the server's lists are slow).
let lastIds: { at: number; ids: Set<string> } | null = null;
const IDS_TTL_MS = 60_000;

export async function fetchModels(): Promise<ModelInfo[]> {
  const res = await fetch("/api/models");
  if (!res.ok) throw new Error("Failed to fetch models");
  const data = await res.json();
  const models: ModelInfo[] = data.models || [];
  lastIds = { at: Date.now(), ids: new Set(models.map((m) => m.id)) };
  return models;
}

/** Whether the server lists this model: the recent answer if there is one, else one fetch. Null when it cannot be read. */
export async function serverListsModel(id: string): Promise<boolean | null> {
  if (lastIds && Date.now() - lastIds.at < IDS_TTL_MS) return lastIds.ids.has(id);
  return fetchModels().then((l) => l.some((m) => m.id === id), () => null);
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
