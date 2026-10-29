/** A step as the SDK reports it to `prepareStep` and `stopWhen`: enough to spot loops. */
export interface GuardStep {
  text?: string;
  toolCalls?: ReadonlyArray<{ toolCallId?: string; toolName: string; input?: unknown; args?: unknown }>;
  content?: ReadonlyArray<{ type: string; toolCallId?: string }>;
}

const TEXT_ONLY = { toolChoice: "none" } as const;

const isToolOnly = (s: GuardStep) => (s.text ?? "").trim().length < 20 && (s.toolCalls?.length ?? 0) > 0;

/** The SDK reports a call that threw as a `tool-error` part with the same toolCallId. */
const callFailed = (step: GuardStep, call: { toolCallId?: string }) =>
  step.content?.some((p) => p.type === "tool-error" && p.toolCallId === call.toolCallId) ?? false;

/** The last two steps made the same first call with the same arguments, and the earlier one did not fail. */
function repeatedCall(steps: GuardStep[]): boolean {
  if (steps.length < 2) return false;
  const a = steps[steps.length - 1].toolCalls?.[0];
  const earlierStep = steps[steps.length - 2];
  const b = earlierStep.toolCalls?.[0];
  if (!a || !b || a.toolName !== b.toolName) return false;
  if (callFailed(earlierStep, b)) return false;
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

/**
 * Fallback for a provider that ignores toolChoice "none": stop once a forced text step was still
 * tool-only. The forced step is the one after `toolOnlyLimit` tool-only steps, hence `> toolOnlyLimit`.
 */
export function ignoredTextStep(steps: GuardStep[], toolOnlyLimit: number): boolean {
  return steps.length > toolOnlyLimit && steps.slice(-toolOnlyLimit).every(isToolOnly);
}
