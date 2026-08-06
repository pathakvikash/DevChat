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

/** Apply {@link normalizeToolParts} across a list of UI messages. */
export function normalizeMessageToolParts<T extends { parts?: unknown }>(
  messages: T[],
): T[] {
  return messages.map((m) =>
    m && Array.isArray((m as any).parts)
      ? ({ ...m, parts: normalizeToolParts((m as any).parts) } as T)
      : m,
  );
}
