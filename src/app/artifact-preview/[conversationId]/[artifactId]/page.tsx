// The only top-level page for an HTML artifact: the artifact runs in a frame it cannot navigate away
// (frame-src 'self'), never as a page of its own.
export const metadata = { title: "Artifact preview" };

export default async function ArtifactPreviewPage({ params }: { params: Promise<{ conversationId: string; artifactId: string }> }) {
  const { conversationId, artifactId } = await params;
  return (
    <iframe
      title="Artifact preview"
      sandbox="allow-scripts"
      src={`/api/conversations/${encodeURIComponent(conversationId)}/artifacts/${encodeURIComponent(artifactId)}/html`}
      className="fixed inset-0 h-full w-full border-0 bg-white"
    />
  );
}
