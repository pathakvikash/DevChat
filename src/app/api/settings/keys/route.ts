import { NextRequest, NextResponse } from "next/server";
import { getSettingsKey, setSettingsKey, deleteSettingsKey, maskKey } from "@/lib/settings";
import { requireUserId } from "@/lib/auth";

const ALL_KEYS = [
  "openrouterApiKey",
  "nvidiaNimApiKey",
  "defaultModel",
  "searchProvider",
  "customInstructions",
] as const;

export async function GET() {
  const userId = await requireUserId();
  const keys: Record<string, string | null> = {};
  for (const name of ALL_KEYS) {
    const raw = await getSettingsKey(userId, name);
    if (name === "openrouterApiKey" || name === "nvidiaNimApiKey") {
      keys[name] = raw ? maskKey(raw) : null;
    } else {
      keys[name] = raw;
    }
  }
  return NextResponse.json(keys);
}

export async function PUT(req: NextRequest) {
  const userId = await requireUserId();
  const body = await req.json();
  const updated: string[] = [];
  for (const name of ALL_KEYS) {
    if (body[name] !== undefined) {
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
