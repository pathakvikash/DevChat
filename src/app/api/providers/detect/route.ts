import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { PROVIDERS } from "@/lib/providers";
import { detectionAvailable, scanLocalCredentials } from "@/lib/providerDetect";
import { setSettingsKey, maskKey } from "@/lib/settings";

/** Consent-based key import: POST {} scans, POST { import } saves only those items.
 *  Raw keys never leave the server — the client sees masked values and (provider, source). */
export async function POST(req: NextRequest) {
  const userId = await requireUserId();
  if (!detectionAvailable()) {
    return NextResponse.json(
      { error: "Provider detection only works when DevChat runs on your own machine." },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const { candidates: found, report } = await scanLocalCredentials();

  if (Array.isArray(body.import)) {
    const imported: string[] = [];
    for (const item of body.import as Array<{ providerId?: string; source?: string }>) {
      const match = found.find((f) => f.providerId === item.providerId && f.source === item.source);
      const def = PROVIDERS.find((p) => p.id === item.providerId);
      if (!match || !def) continue;
      await setSettingsKey(userId, def.settingKey, match.apiKey);
      imported.push(def.id);
    }
    return NextResponse.json({ imported });
  }

  return NextResponse.json({
    report,
    candidates: found.map((c) => ({
      providerId: c.providerId,
      label: PROVIDERS.find((p) => p.id === c.providerId)?.label ?? c.providerId,
      source: c.source,
      maskedKey: maskKey(c.apiKey),
    })),
  });
}
