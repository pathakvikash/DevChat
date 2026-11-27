import { NextResponse } from "next/server";
import { listModels } from "@/lib/models";
import { resolveProviderCreds } from "@/lib/apiKeys";
import { mockModelCatalog } from "@/lib/mockModels";
import { requireUserId } from "@/lib/auth";
import { canUseHostTools } from "@/lib/hostAccess";

export async function GET() {
  const userId = await requireUserId();
  const creds = await resolveProviderCreds(userId);
  const { models, status } = await listModels(creds, await canUseHostTools(userId));

  return NextResponse.json({
    // Strip the runtime `model` instance; the client only
    // needs the catalog shape.
    models: [
      ...mockModelCatalog(), // sanity suite only; empty otherwise
      ...models.map(
        ({ model: _m, maxTokens: _t, ...entry }) =>
          entry,
      ),
    ],
    providers: status,
    ollamaAvailable: models.some((m) => m.id.startsWith("ollama/")),
  });
}
