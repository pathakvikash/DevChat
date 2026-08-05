"use client";

const BASE = "/api/settings/keys";

export interface SettingsData {
  openrouterApiKey: string | null;
  nvidiaNimApiKey: string | null;
  defaultModel: string | null;
  searchProvider: string | null;
  customInstructions: string | null;
}

export async function fetchSettings(): Promise<SettingsData> {
  const res = await fetch(BASE);
  if (!res.ok) throw new Error("Failed to fetch settings");
  return res.json();
}

export async function saveSettings(payload: Partial<SettingsData>): Promise<void> {
  await fetch(BASE, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteSettings(keys: (keyof SettingsData)[]): Promise<void> {
  const body: Record<string, boolean> = {};
  for (const k of keys) body[k] = true;
  await fetch(BASE, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
