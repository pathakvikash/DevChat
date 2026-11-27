// Stand-in for the backend slice's src/lib/apps/registry.ts, used only until it is merged. Tests mock the real path.
import type { AppRecord, OrreryResult } from "../types";

export async function listApps(_userId: string): Promise<AppRecord[]> {
  return [];
}
export async function getApp(_userId: string, _id: string): Promise<AppRecord | null> {
  return null;
}
export async function callAppTool(
  _userId: string,
  _email: string,
  _appId: string,
  _toolName: string,
  _args: Record<string, unknown>,
  _opts: { signal?: AbortSignal; timeoutMs?: number },
): Promise<{ text: string; structured?: OrreryResult }> {
  throw new Error("apps registry not available");
}
