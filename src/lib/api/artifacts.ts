import { prisma } from "@/lib/db";
import type { Artifact } from "@prisma/client";

export type ArtifactLookupResult =
  | { ok: true; artifact: Artifact }
  | { ok: false; reason: "not_found" | "wrong_conversation" };

/** Looks up an artifact by id and confirms it belongs to `conversationId`. */
export async function findConversationArtifact(
  conversationId: string,
  artifactId: string,
): Promise<ArtifactLookupResult> {
  const artifact = await prisma.artifact.findUnique({ where: { id: artifactId } });
  if (!artifact) return { ok: false, reason: "not_found" };
  if (artifact.conversationId !== conversationId) {
    return { ok: false, reason: "wrong_conversation" };
  }
  return { ok: true, artifact };
}
