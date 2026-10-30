import { convertToModelMessages, generateId, readUIMessageStream, stepCountIs, streamText, type Tool, type UIMessage } from "ai";
import type { ModelConfig } from "@/lib/models";
import type { ToolMode } from "@/lib/chat/buildTools";
import { normalizeMessageToolParts, normalizeToolParts } from "@/lib/chat/normalizeToolParts";
import { nextStepSettings } from "@/lib/chat/loopGuard";
import { quotePastChat } from "@/lib/chat/quotePastChat";

type ProviderOptions = NonNullable<Parameters<typeof streamText>[0]["providerOptions"]>;

export const SUB_AGENT_MAX_STEPS = 15;
export const SUB_AGENT_TIMEOUT_MS = 300_000;
/** Character cap on the report (the spec says characters, so this is not `cutTokens`). */
export const REPORT_MAX_CHARS = 8_000;
const PROGRESS_EVERY_MS = 250;
const PREVIEW_CHARS = 300;
const CUT_MARKER = "\n…cut…";

/** Browser-only tools and the ones that act on the parent chat. A helper never gets them. */
const STRIPPED_TOOLS = new Set([
  "runAgent",
  "messageAgent",
  "sendToChat",
  "presentPlan",
  "executeCode",
  "askClarification",
  "createTodo",
  "createTodos",
  "updateTodo",
]);

/** Small progress events. `text delta` is a summary, throttled to one per 250 ms. */
export type SubAgentProgress =
  | { type: "step started"; step: number }
  | { type: "tool call"; step: number; tool: string; label: string }
  | { type: "tool result"; step: number; tool: string; ok: boolean }
  | { type: "text delta"; chars: number; preview: string };

export interface RunSubAgentOptions {
  brief: string;
  /** The parent's model config: same model, same fallback as the parent. */
  model: ModelConfig;
  mode: ToolMode;
  workingFolder?: string | null;
  /** The parent's built tool set. Stripped of recursion and browser-only tools before use. */
  tools: Record<string, Tool>;
  /** The parent's provider options (CLI cwd and access come through here). */
  providerOptions?: ProviderOptions;
  abortSignal: AbortSignal;
  onProgress?: (event: SubAgentProgress) => void;
  /** The default is 5 minutes; tests pass a short one. */
  timeoutMs?: number;
  /** A follow-up run: the helper's saved messages, then `message` as the new user turn (`brief` is unused). */
  resume?: { history: UIMessage[]; message: UIMessage };
}

export interface SubAgentResult {
  status: "done" | "error" | "timeout" | "stopped";
  /** The helper's final text, capped at `REPORT_MAX_CHARS`. */
  report: string;
  /** Model steps taken. */
  steps: number;
  usage: { inputTokens: number; outputTokens: number };
  /** The brief as a user message, then the helper's reply as an assistant message (tool parts normalized). */
  transcript: UIMessage[];
  error?: string;
}

type AnyPart = { type: string; [key: string]: any };

function helperPrompt(mode: ToolMode, workingFolder?: string | null): string {
  return [
    "You are a helper started by another assistant. Do the brief alone. You cannot ask the user questions; use tools as needed.",
    `End with a report for the other assistant: facts and file paths first, under ${REPORT_MAX_CHARS.toLocaleString("en-US")} characters.`,
    mode === "agent" ? "Mode: agent. You may change files in the working folder." : "Mode: read-only. Change nothing.",
    `Working folder: ${workingFolder || "none"}.`,
  ].join("\n");
}

/** The parent's provider options for a helper. A CLI helper outside Agent mode only reads: no permission bridge, no
 *  allow list, and no chat id (so it cannot close the chat's open card). Ask and Plan promise read-only helpers. */
export function helperProviderOptions(options: ProviderOptions | undefined, mode: ToolMode): ProviderOptions | undefined {
  if (!options || mode === "agent") return options;
  return Object.fromEntries(
    Object.entries(options).map(([id, o]) => [id, "access" in o ? { ...o, access: "chat", allowedTools: [], conversationId: "" } : o]),
  );
}

function helperTools(tools: Record<string, Tool>): Record<string, Tool> {
  return Object.fromEntries(Object.entries(tools).filter(([name]) => !STRIPPED_TOOLS.has(name)));
}

/** The report cap: a report, or a saved turn that is resent to a resumed helper, is cut to REPORT_MAX_CHARS. */
export function capReport(text: string): string {
  if (text.length <= REPORT_MAX_CHARS) return text;
  return text.slice(0, REPORT_MAX_CHARS - CUT_MARKER.length) + CUT_MARKER;
}

const isToolPart = (p: AnyPart) => p.type === "dynamic-tool" || p.type.startsWith("tool-");
const toolName = (p: AnyPart) => (p.type === "dynamic-tool" ? String(p.toolName) : p.type.slice(5));
const textOf = (parts: AnyPart[]) =>
  parts.filter((p) => p.type === "text").map((p) => String(p.text ?? "")).join("");
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Runs one helper for a brief: a nested streamText with its own step cap and timeout.
 * Never throws for a model or tool failure; the status says what happened.
 */
export async function runSubAgent(opts: RunSubAgentOptions): Promise<SubAgentResult> {
  const { brief, model, mode, workingFolder, onProgress = () => {}, timeoutMs = SUB_AGENT_TIMEOUT_MS, resume } = opts;
  const providerOptions = helperProviderOptions(opts.providerOptions, mode);
  const userMessage: UIMessage = resume?.message ?? { id: generateId(), role: "user", parts: [{ type: "text", text: brief }] };
  const zeroUsage = { inputTokens: 0, outputTokens: 0 };

  // Text deltas: the first one goes out at once, then at most one per window; the last pending one goes at the window's end.
  let finished = false;
  let lastTextAt = -Infinity;
  let pendingText: Extract<SubAgentProgress, { type: "text delta" }> | undefined;
  let textTimer: ReturnType<typeof setTimeout> | undefined;
  const flushText = () => {
    clearTimeout(textTimer);
    textTimer = undefined;
    if (!pendingText) return;
    lastTextAt = Date.now();
    onProgress(pendingText);
    pendingText = undefined;
  };

  const finish = (
    status: SubAgentResult["status"],
    last: UIMessage | undefined,
    usage = zeroUsage,
    error?: string,
  ): SubAgentResult => {
    finished = true;
    flushText();
    const parts = (last?.parts ?? []) as AnyPart[];
    // Text after the last step is the report; earlier steps only narrate their tool calls.
    const lastStep = parts.map((p) => p.type).lastIndexOf("step-start");
    let report = textOf(parts.slice(lastStep + 1)).trim();
    const steps = parts.filter((p) => p.type === "step-start").length;
    if (!report && steps >= SUB_AGENT_MAX_STEPS) {
      report = `Stopped at the ${SUB_AGENT_MAX_STEPS}-step limit with no written report.`;
    }
    const assistant: UIMessage = {
      id: last?.id ?? generateId(),
      role: "assistant",
      parts: normalizeToolParts(last?.parts ?? []) as UIMessage["parts"],
    };
    return {
      status,
      report: capReport(report),
      steps,
      usage,
      transcript: [userMessage, assistant],
      ...(error ? { error } : {}),
    };
  };

  if (opts.abortSignal.aborted) return finish("stopped", undefined);

  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = AbortSignal.any([opts.abortSignal, timeout]);
  // Models that cannot take tools get one text step, whatever the caller passed.
  const tools = model.supportsTools ? helperTools(opts.tools) : {};
  const hasTools = Object.keys(tools).length > 0;

  let last: UIMessage | undefined;
  let errorText: string | undefined;
  let stepsSeen = 0;
  const toolCallsSeen = new Set<string>();
  const toolResultsSeen = new Set<string>();

  const report = (message: UIMessage) => {
    if (finished) return;
    last = message;
    const parts = message.parts as AnyPart[];
    const step = parts.filter((p) => p.type === "step-start").length;
    if (step > stepsSeen) {
      stepsSeen = step;
      onProgress({ type: "step started", step });
    }
    for (const p of parts) {
      if (!isToolPart(p)) continue;
      const id = String(p.toolCallId);
      if (!toolCallsSeen.has(id)) {
        toolCallsSeen.add(id);
        onProgress({ type: "tool call", step, tool: toolName(p), label: JSON.stringify(p.input ?? {}).slice(0, 80) });
      }
      if ((p.state === "output-available" || p.state === "output-error") && !toolResultsSeen.has(id)) {
        toolResultsSeen.add(id);
        onProgress({ type: "tool result", step, tool: toolName(p), ok: p.state === "output-available" });
      }
    }
    const text = textOf(parts);
    if (!text) return;
    pendingText = { type: "text delta", chars: text.length, preview: text.slice(-PREVIEW_CHARS) };
    const wait = PROGRESS_EVERY_MS - (Date.now() - lastTextAt);
    if (wait <= 0) flushText();
    else textTimer ??= setTimeout(flushText, wait);
  };

  let result: ReturnType<typeof streamText>;
  try {
    const messages = resume
      ? await convertToModelMessages(normalizeMessageToolParts([...resume.history, userMessage]), { tools })
      : [{ role: "user" as const, content: brief }];
    result = streamText({
      model: model.model,
      system: helperPrompt(mode, workingFolder),
      messages,
      ...(hasTools ? { tools } : {}),
      // The last step must write the report: no more tool calls. Models that ignore it
      // still stop at the cap, with a note.
      prepareStep: hasTools
        ? ({ steps, stepNumber }) => nextStepSettings({ steps, stepNumber, maxSteps: SUB_AGENT_MAX_STEPS })
        : undefined,
      stopWhen: stepCountIs(SUB_AGENT_MAX_STEPS),
      abortSignal: signal,
      maxOutputTokens: model.maxTokens,
      ...(providerOptions ? { providerOptions } : {}),
    });
  } catch (err) {
    return finish("error", undefined, zeroUsage, errorMessage(err));
  }

  const consume = async () => {
    const ui = result.toUIMessageStream<UIMessage>({
      onError: (err) => {
        errorText = errorMessage(err);
        return errorText;
      },
    });
    for await (const message of readUIMessageStream<UIMessage>({ stream: ui })) report(message);
  };

  // The model may not close its stream on abort, so race the run against the signal.
  const cut = new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });
  try {
    await Promise.race([consume(), cut]);
  } catch (err) {
    errorText ??= errorMessage(err);
  }

  const status: SubAgentResult["status"] = opts.abortSignal.aborted
    ? "stopped"
    : timeout.aborted
      ? "timeout"
      : errorText
        ? "error"
        : "done";

  // totalUsage rejects when the run was cut short.
  let usage = zeroUsage;
  if (status === "done" || status === "error") {
    try {
      const total = await result.totalUsage;
      usage = { inputTokens: total.inputTokens ?? 0, outputTokens: total.outputTokens ?? 0 };
    } catch {
      usage = zeroUsage;
    }
  }
  return finish(status, last, usage, status === "error" ? errorText : undefined);
}

export type SubAgentStatus = SubAgentResult["status"] | "running";

export interface SubAgentStep {
  tool: string;
  label: string;
  state: "running" | "done" | "error";
}

/** The `runAgent` tool's output. While it runs, each yield replaces the last; the final one is the result. */
export interface SubAgentOutput {
  childId?: string;
  title: string;
  status: SubAgentStatus;
  startedAt: number;
  endedAt?: number;
  /** Model steps started so far. */
  step: number;
  /** The last 20 tool calls. */
  steps: SubAgentStep[];
  preview?: string;
  report?: string;
  hitStepLimit?: boolean;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export function startSubAgentOutput(title: string, startedAt: number, childId?: string): SubAgentOutput {
  return { childId, title, status: "running", startedAt, step: 0, steps: [] };
}

export function applySubAgentProgress(out: SubAgentOutput, event: SubAgentProgress): SubAgentOutput {
  switch (event.type) {
    case "step started":
      return { ...out, step: event.step };
    case "tool call":
      return {
        ...out,
        steps: [...out.steps, { tool: event.tool, label: event.label, state: "running" as const }].slice(-20),
      };
    case "tool result": {
      const steps = [...out.steps];
      let i = steps.length - 1;
      while (i >= 0 && !(steps[i].tool === event.tool && steps[i].state === "running")) i--;
      if (i >= 0) steps[i] = { ...steps[i], state: event.ok ? "done" : "error" };
      return { ...out, steps };
    }
    case "text delta":
      return { ...out, preview: event.preview };
  }
}

export function finishSubAgentOutput(out: SubAgentOutput, result: SubAgentResult, endedAt: number): SubAgentOutput {
  return {
    ...out,
    status: result.status,
    endedAt,
    step: result.steps,
    preview: undefined,
    report: result.report || undefined,
    hitStepLimit: result.steps >= SUB_AGENT_MAX_STEPS || undefined,
    error: result.error,
    usage: result.usage,
  };
}

/** What the parent model reads. Helper text is quoted as reference data, so it cannot pose as instructions. */
export function subAgentModelOutput(
  out: SubAgentOutput,
): { type: "text"; value: string } | { type: "error-text"; value: string } {
  const who = out.childId ? `Sub-agent ${out.childId}` : "Sub-agent";
  if (out.status === "done") return { type: "text", value: quotePastChat(`${who} report`, out.report ?? "") };
  const why =
    out.status === "error"
      ? `failed${out.error ? `: ${out.error}` : ""}`
      : out.status === "timeout"
        ? "timed out after 5 minutes"
        : "was stopped";
  const notes = out.report ? `\n${quotePastChat(`${who} partial notes`, out.report)}` : "";
  return { type: "error-text", value: `${who} ${why}.${notes}` };
}
