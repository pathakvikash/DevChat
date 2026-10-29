/** A step as the SDK reports it to `prepareStep`: enough to spot loops. */
export interface GuardStep {
  text?: string;
  toolCalls?: ReadonlyArray<{ toolName: string; input?: unknown; args?: unknown }>;
}

const TEXT_ONLY = { toolChoice: "none" } as const;

const isToolOnly = (s: GuardStep) => (s.text ?? "").trim().length < 20 && (s.toolCalls?.length ?? 0) > 0;

/** The last two steps made the same first call with the same arguments. */
function repeatedCall(steps: GuardStep[]): boolean {
  if (steps.length < 2) return false;
  const a = steps[steps.length - 1].toolCalls?.[0];
  const b = steps[steps.length - 2].toolCalls?.[0];
  if (!a || !b || a.toolName !== b.toolName) return false;
  return JSON.stringify(a.input ?? a.args ?? {}) === JSON.stringify(b.input ?? b.args ?? {});
}

/**
 * Forces a text-only step (no tools) when the run is looping, or when the next step is the last
 * allowed one, so a turn always ends with a written answer. Otherwise undefined.
 */
export function nextStepSettings({
  steps,
  stepNumber,
  maxSteps,
  toolOnlyLimit,
}: {
  steps: GuardStep[];
  stepNumber: number;
  maxSteps: number;
  toolOnlyLimit?: number;
}): { toolChoice: "none" } | undefined {
  if (repeatedCall(steps)) return TEXT_ONLY;
  if (toolOnlyLimit && steps.length >= toolOnlyLimit && steps.slice(-toolOnlyLimit).every(isToolOnly)) return TEXT_ONLY;
  if (stepNumber >= maxSteps - 1) return TEXT_ONLY;
  return undefined;
}
