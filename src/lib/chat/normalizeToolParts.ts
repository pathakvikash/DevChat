/**
 * Collapse duplicate tool parts and fix bogus states so every call has a result.
 * Providers reject dangling calls and drop the whole history along with them.
 */
export function normalizeToolParts(parts: unknown): unknown {
  if (!Array.isArray(parts)) return parts;

  const out: any[] = [];
  const indexByCallId = new Map<string, number>();

  for (const part of parts as any[]) {
    const type: string | undefined = part?.type;
    if (typeof type !== "string" || !type.startsWith("tool-")) {
      out.push(part);
      continue;
    }

    const callId = part.toolCallId;
    // No id to pair on, so leave it alone.
    if (!callId) {
      out.push(part);
      continue;
    }

    const existingIdx = indexByCallId.get(callId);
    if (existingIdx === undefined) {
      indexByCallId.set(callId, out.length);
      out.push({ ...part });
      continue;
    }
    // Seen this call before (old call + result pair) — merge them.
    const merged = { ...out[existingIdx] };
    for (const [k, v] of Object.entries(part)) {
      if (v !== undefined && v !== null) merged[k] = v;
    }
    out[existingIdx] = merged;
  }

  // A part is only "available" if it really has output.
  for (const idx of indexByCallId.values()) {
    const part = out[idx];
    const hasOutput = part.output !== undefined && part.output !== null;
    if (hasOutput) {
      part.state = "output-available";
      delete part.errorText;
    } else if (part.state !== "output-error") {
      part.state = "output-error";
      part.errorText = part.errorText || "No output was recorded for this tool call.";
    }
  }

  return out;
}

/** One RFC-6902 patch line the model wrote inside a ```spec fence. */
const SPEC_PART = "data-spec";
/** `/elements/<key>` — a whole element, so `value.type` is its component name. */
const ELEMENT_PATH_RE = /^\/elements\/[^/]+$/;

/** Replace `data-spec` parts with a one-line note: `convertToModelMessages` drops `data-*`
 *  parts, and re-sending raw JSONL would burn context and invite stale patch streams. */
export function summarizeSpecParts(parts: unknown): unknown {
  if (!Array.isArray(parts)) return parts;
  const at = parts.findIndex((p) => p?.type === SPEC_PART);
  if (at < 0) return parts;

  const counts = new Map<string, number>();
  const dataIds = new Set<string>();
  for (const p of parts) {
    if (p?.type !== SPEC_PART) continue;
    const patch = p.data?.patch ?? p.data;
    const path = String(patch?.path ?? "");
    const value = patch?.value;
    if (path.endsWith("/props/dataArtifactId") && typeof value === "string") dataIds.add(value);
    if (!value || typeof value !== "object") continue;
    if (typeof value.type === "string" && ELEMENT_PATH_RE.test(path)) {
      counts.set(value.type, (counts.get(value.type) ?? 0) + 1);
    }
    if (typeof value.props?.dataArtifactId === "string") dataIds.add(value.props.dataArtifactId);
  }

  const components = [...counts]
    .map(([name, n]) => (n > 1 ? `${name} ×${n}` : name))
    .join(", ");
  const note =
    `[You rendered a UI here: ${components || "no components"}` +
    `${dataIds.size ? ` from data artifact ${[...dataIds].join(", ")}` : ""}. ` +
    "The spec's JSONL is not kept in this transcript — to change what is shown, " +
    "emit a new complete ```spec block.]";

  const out = parts.filter((p) => p?.type !== SPEC_PART);
  out.splice(at, 0, { type: "text", text: note });
  return out;
}

/** Prepare UI messages for `convertToModelMessages`. */
export function normalizeMessageToolParts<T extends { parts?: unknown }>(
  messages: T[],
): T[] {
  return messages.map((m) =>
    m && Array.isArray((m as any).parts)
      ? ({ ...m, parts: summarizeSpecParts(normalizeToolParts((m as any).parts)) } as T)
      : m,
  );
}
