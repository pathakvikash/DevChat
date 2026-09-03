"use client";

const BASE = "/api/settings/keys";

/**
 * Server-side settings. Provider API keys come back masked; keys are named
 * by `PROVIDERS[].settingKey` (e.g. `openaiApiKey`) plus `customBaseUrl`.
 * `envProviders` lists provider ids already configured by the deployment's
 * env vars.
 */
export interface SettingsData {
  [key: string]: string | null | string[] | boolean | undefined;
  defaultModel: string | null;
  searchProvider: string | null;
  customInstructions: string | null;
  envProviders?: string[];
  /** Server runs on this machine, so it can scan local tool configs for keys. */
  detectionAvailable?: boolean;
}

export async function fetchSettings(): Promise<SettingsData> {
  const res = await fetch(BASE);
  if (!res.ok) throw new Error("Failed to fetch settings");
  return res.json();
}

export async function saveSettings(payload: Record<string, string>): Promise<void> {
  await fetch(BASE, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteSettings(keys: string[]): Promise<void> {
  const body: Record<string, boolean> = {};
  for (const k of keys) body[k] = true;
  await fetch(BASE, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export interface DetectedProvider {
  providerId: string;
  label: string;
  source: string;
  maskedKey: string;
}

export interface ToolReportInfo {
  tool: string;
  status: "keys" | "oauth" | "none" | "absent";
  detail: string;
}

/** Scan this machine for API keys other tools store. Read-only; saves nothing. */
export async function detectProviders(): Promise<{
  candidates: DetectedProvider[];
  report: ToolReportInfo[];
}> {
  const res = await fetch("/api/providers/detect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Detection failed");
  const data = await res.json();
  return { candidates: data.candidates || [], report: data.report || [] };
}

/** Save the chosen detected keys into this user's settings. */
export async function importDetectedProviders(
  items: Array<{ providerId: string; source: string }>,
): Promise<string[]> {
  const res = await fetch("/api/providers/detect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ import: items }),
  });
  if (!res.ok) throw new Error("Import failed");
  return (await res.json()).imported || [];
}

export interface PairingInfo {
  code: string;
  command: string;
  scriptUrl: string;
  expiresInSeconds: number;
}

/** Mint a one-time pairing code for "connect this computer" on hosted deployments. */
export async function startPairing(): Promise<PairingInfo> {
  const res = await fetch("/api/providers/pair", { method: "POST" });
  if (!res.ok) throw new Error("Could not start pairing");
  return res.json();
}
