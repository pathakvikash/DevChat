import { NextRequest, NextResponse } from "next/server";
import { findConversationArtifact } from "@/lib/api/artifacts";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; artifactId: string }> }
) {
  try {
    const { id, artifactId } = await params;

    const result = await findConversationArtifact(id, artifactId);
    if (!result.ok) {
      return new NextResponse(
        result.reason === "not_found" ? "Artifact not found" : "Artifact not in this conversation",
        { status: result.reason === "not_found" ? 404 : 400 },
      );
    }
    const { artifact } = result;

    if (artifact.type !== "html") {
      return new NextResponse("Artifact is not HTML", { status: 400 });
    }

    return new NextResponse(artifact.content, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  } catch (error) {
    console.error("Failed to serve HTML artifact:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
