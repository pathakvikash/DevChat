import { NextRequest, NextResponse } from "next/server";
import { getSettingsKeys, setSettingsKey, deleteSettingsKey, maskKey } from "@/lib/settings";
import { PROVIDERS } from "@/lib/providers";
import { detectionAvailable } from "@/lib/providerDetect";
import { requireUserId } from "@/lib/auth";

const PROVIDER_KEYS = PROVIDERS.flatMap((p) =>
  p.baseUrlSettingKey ? [p.settingKey, p.baseUrlSettingKey] : [p.settingKey],
);

const ALL_KEYS = [...PROVIDER_KEYS, "defaultModel", "searchProvider", "customInstructions"];

function isSecret(name: string) {
  return name.endsWith("ApiKey");
}

export async function GET() {
  const userId = await requireUserId();
  const saved = await getSettingsKeys(userId, ALL_KEYS);
  const keys: Record<string, string | null | string[] | boolean> = {};
  for (const name of ALL_KEYS) {
    const raw = saved[name];
    keys[name] = raw ? (isSecret(name) ? maskKey(raw) : raw) : null;
  }
  // Providers already usable through the server's env vars, so the UI can
  // say "configured by this deployment" instead of "not configured".
  keys.envProviders = PROVIDERS.filter(
    (p) => process.env[p.envKey] || (p.envBaseUrl && process.env[p.envBaseUrl]),
  ).map((p) => p.id);
  keys.detectionAvailable = detectionAvailable();
  return NextResponse.json(keys);
}

export async function PUT(req: NextRequest) {
  const userId = await requireUserId();
  const body = await req.json();
  const updated: string[] = [];
  for (const name of ALL_KEYS) {
    if (typeof body[name] === "string") {
      await setSettingsKey(userId, name, body[name]);
      updated.push(name);
    }
  }
  return NextResponse.json({ ok: true, updated });
}

export async function DELETE(req: NextRequest) {
  const userId = await requireUserId();
  const body = await req.json();
  const removed: string[] = [];
  for (const name of ALL_KEYS) {
    if (body[name] || body.all) {
      await deleteSettingsKey(userId, name);
      removed.push(name);
    }
  }
  return NextResponse.json({ ok: true, removed });
}
