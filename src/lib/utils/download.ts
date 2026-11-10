/** Triggers a browser download of `blob` named `filename` via a temporary anchor click. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Downloads a saved chat from the export route and toasts the file name, or the failure. */
export async function exportChat(
  conversationId: string,
  format: "markdown" | "json",
  toast: (message: string, type: "success" | "error") => void,
): Promise<void> {
  try {
    const res = await fetch(`/api/conversations/${conversationId}/export?format=${format}`);
    if (!res.ok) throw new Error(`export failed: ${res.status}`);
    const named = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "");
    const filename = named?.[1] ?? `${conversationId}.${format === "json" ? "json" : "md"}`;
    downloadBlob(await res.blob(), filename);
    toast(`Exported "${filename}"`, "success");
  } catch (e) {
    console.error("[exportChat]", e);
    toast("Couldn't export this chat", "error");
  }
}
