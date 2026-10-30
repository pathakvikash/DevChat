import {
  convertToModelMessages,
  generateId,
  streamText,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";
import { pipeJsonRender } from "@json-render/core";
import { prisma } from "@/lib/db";
import { getModel } from "@/lib/models";
import { CHAT_ALLOWABLE_TOOLS, denyOpenApprovals, extractText, stripFileParts } from "@/lib/utils/messageParts";
import {
  buildSystemPrompt,
} from "@/lib/chat/buildSystemPrompt";
import {
  buildTools,
  resolveActiveToolIds,
  type ToolSet,
  type ToolMode,
} from "@/lib/chat/buildTools";
import { canStartSubAgents, messageAgentTool, runAgentTool, type SubAgentToolOptions } from "@/lib/chat/buildTools";
import {
  agentMessageModelText,
  agentPartRefused,
  parseOpenPanes,
  sendToChatTargets,
} from "@/lib/chat/agentMessages";
import { ignoredTextStep, nextStepSettings } from "@/lib/chat/loopGuard";
import { safePersistAssistantMessage } from "@/lib/chat/persistAssistantMessage";
import { autoCompress, canAutoCompress } from "@/lib/chat/autoCompress";
import { liveSince } from "@/lib/liveSince";
import { normalizeMessageToolParts } from "@/lib/chat/normalizeToolParts";
import { dropCompressedMessages } from "@/lib/chat/dropCompressedMessages";
import { saveUserMessage } from "@/lib/chat/saveUserMessage";
import {
  isTransientProviderError,
  friendlyProviderErrorMessage,
  formatMissingApiKeyMessage,
} from "@/lib/chat/providerErrors";
import { contextWindowFor } from "@/lib/chat/contextBudget";
import {
  claimQueued,
  queuedMarkerTransform,
  releaseUnshown,
  withInjected,
  type QueuedInjection,
  type QueuedMarker,
} from "@/lib/chat/queue";
import { dropRepeatedToolCalls } from "@/lib/chat/dropRepeatedToolCalls";
import { resolveChatSettings } from "@/lib/chat/resolveChatSettings";
import { resolveModelCandidates } from "@/lib/chat/resolveModelCandidates";
import { cliProviderForModel, dropParkedRuns } from "@/lib/cliProviders";
import { isRunnableCwd } from "@/lib/claude/sessions";
import { recordTrace } from "@/lib/observability";
import {
  estimatePromptTokens,
  shouldIncreaseContext,
  getNextContextTier,
} from "@/lib/contextManager";
import { requireUserId } from "@/lib/auth";
import { canUseHostTools, HOST_TOOLS_REFUSED } from "@/lib/hostAccess";
import { effectiveToolMode, isChatMode, MODE_POLICY, toolsWithAnsweredApproval } from "@/lib/chat/modes";

// A helper run can take minutes: the 5-minute limit plus the parent's own steps.
export const maxDuration = 600;

export async function POST(req: Request) {
  const requestStartedAt = Date.now();
  let traceRecorded = false;
  const userId = await requireUserId();
  const {
    messages: bodyMessages,
    conversationId,
    model: bodyModel,
    systemPrompt: bodySystemPrompt,
    temperature: bodyTemperature,
    ragContext,
    kbId: bodyKbId,
    attachments: bodyAttachments,
    searchProvider: bodySearchProvider,
    enabledTools: bodyEnabledTools,
    enabledSkills: bodyEnabledSkills,
    chatOnlyMode: bodyChatOnlyMode,
    memoryDisabled: bodyMemoryDisabled,
    autoCompressThreshold: bodyAutoCompressThreshold,
    maxToolCalls: bodyMaxToolCalls,
    mode: bodyMode,
    allowedTools: bodyAllowedTools,
    openPanes: bodyOpenPanes,
  } = await req.json();
  let messages = bodyMessages;
  // A Claude Code card left open is closed when the chat sends anything that does not answer it.
  const lastParts = Array.isArray(messages) && messages.at(-1)?.role === "assistant" ? (messages.at(-1).parts ?? []) : [];
  const answeringCli = lastParts.some((p: any) => String(p?.approval?.id ?? "").startsWith("cli-"));
  // Only once the chat is known to be this user's: anyone can send any conversation id.
  let ownerVerified = false;
  const releaseCliRuns = () => {
    if (conversationId && ownerVerified) dropParkedRuns(conversationId);
  };
  // Anything unknown falls back to chat, the safest mode.
  const requestedMode: ToolMode = isChatMode(bodyMode) ? bodyMode : "chat";
  // Without AUTH_SECRET the SDK can't sign or verify approvals, so Ask would trust the browser's answers.
  const authMode = effectiveToolMode(requestedMode, !!process.env.AUTH_SECRET);
  if (authMode !== requestedMode) console.warn("[chat] AUTH_SECRET is unset: Ask runs as Chat, since approvals can't be verified.");
  let model: string | undefined = bodyModel;
  try {
    let compressedAt: Date | null = null;
    if (conversationId) {
      const owned = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { userId: true, compressedAt: true, parent: { select: { userId: true } } },
      });
      // A side chat is only ever read against a main chat of the same user.
      if (!owned || owned.userId !== userId || (owned.parent && owned.parent.userId !== userId)) {
        return new Response(JSON.stringify({ error: "Conversation not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      compressedAt = owned.compressedAt;
      ownerVerified = true;
      if (!answeringCli) releaseCliRuns();
    }
    const [settings, summarized] = await Promise.all([
      resolveChatSettings({
        userId,
        conversationId,
        bodyModel,
        bodySystemPrompt,
        bodyTemperature,
        bodyKbId,
        bodySearchProvider,
        bodyEnabledTools,
        bodyEnabledSkills,
        bodyChatOnlyMode,
        bodyMemoryDisabled,
        bodyAutoCompressThreshold,
        bodyMaxToolCalls,
      }),
      // A client that missed the refresh after a compress (Stop, a dropped connection) still
      // holds the summarized messages; keep them out of the prompt next to the summary.
      compressedAt && Array.isArray(messages)
        ? prisma.message.findMany({
            where: {
              conversationId,
              ...liveSince(compressedAt).summarizedWhere,
              id: { in: messages.flatMap((m: { id?: string }) => (m?.id ? [m.id] : [])) },
            },
            select: { id: true },
          })
        : [],
    ]);
    messages = dropCompressedMessages(messages, summarized.map((m) => m.id));
    model = settings.model;
    const {
      searchProvider,
      explicitToolIds,
      skillIds,
      systemPrompt,
      temperature,
      topP,
      chatOnlyMode,
      memoryDisabled,
      fallbackModel,
      maxToolCalls,
      autoCompressThreshold,
      reasoningEffort,
      workingFolder,
    } = settings;
    if (settings.kind === "subagent") {
      return new Response(JSON.stringify({ error: "Sub-agent runs cannot be sent to directly" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const openPanes = parseOpenPanes(bodyOpenPanes);
    if (!openPanes) {
      return new Response(JSON.stringify({ error: "openPanes must be up to 3 panes with an id, title and kind" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    // A malformed agent part, or one past the hop cap, is refused rather than dropped (dropping would leave its text unframed).
    if (Array.isArray(messages) && messages.some(agentPartRefused)) {
      return new Response(JSON.stringify({ error: "An agent message is malformed or past the limit. Answer the user directly." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    // Side chats are read-only, whatever mode the request asks for.
    const toolMode: ToolMode = settings.kind === "side" ? "chat" : authMode;
    // `contextLength`/`maxTokens` are reassigned below (Ollama context bump,
    // default maxTokens), so these two stay `let` unlike the rest.
    let { contextLength, maxTokens, kbId } = settings;
    // `kbId` can come from an unvalidated client-supplied fallback inside
    // resolveChatSettings — verify it's actually owned by this user before
    // letting searchKnowledgeBase / the KB auto-inject read from it.
    if (kbId) {
      const kb = await prisma.knowledgeBase.findUnique({
        where: { id: kbId },
        select: { userId: true },
      });
      if (!kb || kb.userId !== userId) kbId = undefined;
    }

    const resolution = await resolveModelCandidates({
      requestedModel: model,
      fallbackModel,
      userId,
    });
    if (!resolution.ok) {
      releaseCliRuns();
      return new Response(
        JSON.stringify({ error: formatMissingApiKeyMessage(resolution.missingKeyProvider) }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    model = resolution.model;
    const candidateModels = resolution.candidateModels;
    // CLI models run as the server's OS user; a fallback that is one is skipped below (getModel refuses it).
    const hostTools = await canUseHostTools(userId);
    if (!hostTools && cliProviderForModel(model)) {
      releaseCliRuns();
      return new Response(
        JSON.stringify({ error: `${HOST_TOOLS_REFUSED} Pick another model: this one runs on the server's own machine.` }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    let lastError: unknown;
    for (const servedModel of candidateModels) {
    let modelConfig: ReturnType<typeof getModel> | null = null;
    try {
      modelConfig = getModel(servedModel, resolution.creds, hostTools);
    } catch {
      console.error(
        `[chat] model config unavailable for ${servedModel} — skipping fallback candidate`,
      );
      continue;
    }
    if (!maxTokens) maxTokens = 8192;
    const useTools = modelConfig.supportsTools && !chatOnlyMode;
    const activeToolIds = resolveActiveToolIds(explicitToolIds, skillIds, kbId);

    // One result for the prompt's section and the sendToChat tool.
    const agentTargets = sendToChatTargets(openPanes, conversationId ?? "", useTools);
    const { text: finalSystemPrompt, sections } = await buildSystemPrompt({
      useTools,
      systemPrompt,
      skillIds,
      activeToolIds,
      conversationId,
      kbId,
      ragContext,
      messages,
      memoryDisabled,
      userId,
      mode: toolMode,
      contextWindow: contextWindowFor(servedModel, modelConfig, contextLength),
      agentTargets,
    });

    console.log(
      `[chat prompt sections] base=${(sections.base?.length || 0)}ch ` +
        `persona=${(sections.persona?.length || 0)}ch ` +
        `skills=${(sections.skills?.length || 0)}ch ` +
        `tools=${(sections.tools?.length || 0)}ch ` +
        `memory=${(sections.memory?.length || 0)}ch ` +
        `compressed=${(sections.compressed?.length || 0)}ch ` +
        `kb=${(sections.kb?.length || 0)}ch ` +
        `generativeUi=${(sections.generativeUi?.length || 0)}ch`,
    );

    const sanitizedMessages = normalizeMessageToolParts(
      (Array.isArray(messages) ? messages : []).filter(
        (m: any) => m && m.role !== "compression",
      ),
    );
    
    if (conversationId) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.role === "user") {
        const userText = extractText(lastMsg);
        await saveUserMessage({
          conversationId,
          id: typeof lastMsg.id === "string" ? lastMsg.id : undefined,
          text: userText,
          parts: stripFileParts(lastMsg.parts || [{ type: "text", text: userText }]),
          attachments: bodyAttachments,
        });
      }
    }

    // A tool answered in this request keeps needing approval for it (see toolsWithAnsweredApproval).
    const answeredNow = new Set(toolsWithAnsweredApproval(sanitizedMessages));
    const aiTools: ToolSet = useTools
      ? await buildTools({
          activeToolIds,
          searchProvider,
          conversationId,
          userId,
          mode: toolMode,
          memoryDisabled,
          agentTargets,
          allowedTools: Array.isArray(bodyAllowedTools)
            ? bodyAllowedTools.filter((t: unknown): t is string => typeof t === "string" && !answeredNow.has(t))
            : [],
          contextWindow: contextWindowFor(servedModel, modelConfig, contextLength),
        })
      : {};

    const isOllama = servedModel.startsWith("ollama/");

    // Dynamic context management: estimate prompt tokens and bump the
    // Ollama context window before the request if we're approaching the
    // current tier limit.
    if (isOllama && conversationId) {
      const currentCtx = contextLength ?? modelConfig.contextWindow;
      const promptTokens = estimatePromptTokens(
        finalSystemPrompt,
        sanitizedMessages,
        Object.keys(aiTools).length,
      );
      if (shouldIncreaseContext(promptTokens, currentCtx)) {
        const nextCtx = getNextContextTier(currentCtx);
        if (nextCtx) {
          contextLength = nextCtx;
          console.log(
            `[ctx] ${conversationId} prompt=${promptTokens} window=${currentCtx} → increased to ${nextCtx}`,
          );
          prisma.conversation
            .update({
              where: { id: conversationId },
              data: { contextLength: nextCtx },
            })
            .catch(() => {});
        }
      }
    }

    const ollamaOptions = isOllama
      ? {
          num_ctx: contextLength ?? modelConfig.contextWindow,
          temperature,
          top_p: topP ?? 0.9,
          num_predict: maxTokens || -1,
        }
      : {};
    // CLI-backed models take effort/folder/mode as provider options. The folder is
    // re-checked every turn; chat mode is read-only there, agent mode may edit, and
    // Ask lets Claude Code ask per change (its allow-for-chat list rides along).
    const cliProvider = cliProviderForModel(servedModel);
    if (!cliProvider) releaseCliRuns();
    const cliCwd = workingFolder && (await isRunnableCwd(workingFolder)) ? workingFolder : "";
    const providerOptions = isOllama
      ? { ollama: ollamaOptions }
      : cliProvider
        ? {
            [cliProvider.id]: {
              effort: reasoningEffort ?? "",
              cwd: cliCwd,
              access: MODE_POLICY[toolMode].cli,
              conversationId: conversationId ?? "",
              userId,
              allowedTools: Array.isArray(bodyAllowedTools)
                ? bodyAllowedTools.filter((t: unknown): t is string => typeof t === "string" && CHAT_ALLOWABLE_TOOLS.has(t))
                : [],
            },
          }
        : undefined;

    // Only main chats with tools get helpers. A helper runs on this same model, in this mode.
    if (canStartSubAgents(settings.kind, useTools) && conversationId) {
      const subAgents: SubAgentToolOptions = {
        userId,
        parentId: conversationId,
        model: modelConfig,
        mode: toolMode,
        workingFolder,
        providerOptions,
        maxParallel: cliProvider ? 1 : 3,
        activeChildren: new Set<string>(),
      };
      aiTools.runAgent = runAgentTool(aiTools, subAgents);
      aiTools.messageAgent = messageAgentTool(aiTools, subAgents);
    }

    // Built after the tools, so a sub-agent's toModelOutput applies to saved history too.
    const modelMessages = await convertToModelMessages(sanitizedMessages, { tools: aiTools });

    // Per-candidate retry loop (transient errors + Ollama context overflow).
    const RETRIES_PER_MODEL = 2;
    // A last assistant message means this request continues it (a client-side tool round trip):
    // the reply must replace that message in the client and update its row, not add a copy.
    const lastIncoming = messages[messages.length - 1];
    const continuing = lastIncoming?.role === "assistant" ? lastIncoming : null;
    // The stream starts under this id and the reply is saved under it, so client and DB match.
    const assistantMessageId = continuing?.id ?? generateId();
    let traceRecorded = false;
    let partialText = "";
    // Captured from streamText's onFinish so the later createUIMessageStream onFinish,
    // which does the persisting, can still record real token usage.
    let capturedFinishEvent: { steps: any[]; totalUsage?: any } | null = null;
    const partialToolOutputs = new Map<string, { name: string; input: any; start: number }>();
    // Per-tool observations (name/input/output/latency) collected during streaming.
    const toolCallsSeen: { toolName: string; input?: any; output?: any; ok: boolean; latencyMs?: number }[] = [];
    let firstTokenAt: number | null = null;
    for (let attempt = 0; attempt < RETRIES_PER_MODEL; attempt++) {
      try {
        partialText = "";
        partialToolOutputs.clear();
        toolCallsSeen.length = 0;
        firstTokenAt = null;
        // Queued messages delivered between steps, and their markers for the reply stream.
        const injected: QueuedInjection[] = [];
        const claimedIds: string[] = [];
        const pendingMarkers: QueuedMarker[] = [];
        const result = streamText({
          model: modelConfig.model,
          system: finalSystemPrompt,
          messages: modelMessages,
          temperature,
          topP,
          // Signs each approval request so a browser cannot change an approved tool's input.
          experimental_toolApprovalSecret: process.env.AUTH_SECRET || undefined,
          // Hard cap on response length: without it a looping model streams
          // indefinitely and leaves the request permanently pending.
          maxOutputTokens: maxTokens,
          prepareStep: async ({ steps, stepNumber, messages: stepMessages }) => {
            // Queued messages join the history before each step after the first. prepareStep's
            // messages apply to one step only, so the delivered ones are re-added on every step.
            if (conversationId && stepNumber > 0) {
              const claimed = await claimQueued(conversationId);
              // Stop came while the claim ran: no step will show these, so they go back.
              if (req.signal.aborted) {
                await releaseUnshown(claimed.map((q) => q.id), []);
              } else {
                for (const q of claimed) {
                  claimedIds.push(q.id);
                  const content = q.agent ? agentMessageModelText(q.agent, q.text) : q.text;
                  injected.push({ at: stepMessages.length, message: { role: "user", content } });
                  pendingMarkers.push({
                    type: "data-queued-message",
                    id: q.id,
                    data: { queuedId: q.id, text: q.text, ...(q.agent ? { agent: q.agent } : {}) },
                  });
                }
              }
            }
            // Forces a text-only step on a loop or the last allowed step, so a turn ends with an answer.
            const guard = nextStepSettings({ steps, stepNumber, maxSteps: maxToolCalls, toolOnlyLimit: 3 });
            if (!injected.length && !guard) return undefined;
            return {
              ...(injected.length ? { messages: withInjected(stepMessages, injected) } : {}),
              ...guard,
            };
          },
          // Ends at maxToolCalls, or after a step with no tool results (nothing left to read).
          // The loop guard in prepareStep forces the answer; this stops only if a provider ignored that.
          stopWhen: ({ steps }) => {
            if (steps.length >= maxToolCalls) return true;
            if (ignoredTextStep(steps, 3)) return true;
            const last = steps[steps.length - 1] as
              | { toolResults?: unknown[]; content?: Array<{ type: string }> }
              | undefined;
            if (!last) return true;
            const hadToolResult =
              (last.toolResults?.length ?? 0) > 0 ||
              (last.content ?? []).some((p) => (p as { type?: string }).type === "tool-result");
            return !hadToolResult;
          },
          tools: aiTools,
          toolChoice: "auto",
          maxRetries: 0,
          abortSignal: req.signal,
          ...(providerOptions ? { providerOptions } : {}),
          onChunk: ({ chunk }) => {
            if (chunk.type === "text-delta") {
              partialText += chunk.text;
              if (firstTokenAt === null) firstTokenAt = Date.now();
            } else if (chunk.type === "tool-call") {
              partialToolOutputs.set(chunk.toolCallId, {
                name: chunk.toolName,
                input: chunk.input ?? {},
                start: Date.now(),
              });
            } else if (chunk.type === "tool-result" && !chunk.preliminary) {
              const meta = partialToolOutputs.get(chunk.toolCallId);
              const latencyMs = meta?.start ? Date.now() - meta.start : undefined;
              toolCallsSeen.push({
                toolName: chunk.toolName,
                input: meta?.input,
                output: chunk.output,
                ok: true,
                latencyMs,
              });
            }
          },
          onFinish: (event) => {
            if (!conversationId) return;
            capturedFinishEvent = event;
            // Persistence happens in createUIMessageStream's onFinish below, on the
            // post-pipeJsonRender split — this raw text would reload as JSONL lines.

            const text = (event as { text?: string }).text ?? "";
            const stepCount =
              (event as { steps?: unknown[] }).steps?.length ?? 0;
            const hadAnyToolCall = (event as { steps?: Array<{ toolCalls?: unknown[] }> })
              .steps?.some((s) => (s.toolCalls?.length ?? 0) > 0) ?? false;
            if (text.trim().length < 40 && stepCount > 1) {
              console.warn(
                `[chat] SUSPECTED TRUNCATED RESPONSE: model=${servedModel} ` +
                  `steps=${stepCount} textLen=${text.length} ` +
                  `text="${text.slice(0, 80).replace(/\n/g, " ")}" ` +
                  `finishReason=${(event as { finishReason?: string }).finishReason ?? "?"} ` +
                  `— model likely emitted a stop token right after a tool result. ` +
                  `Check system prompt COMPLETION RULES and tool modelDescription.`,
              );
            }
            if (text.trim().length < 10 && !hadAnyToolCall) {
              console.warn(
                `[chat] EMPTY/EMPTYISH RESPONSE WITH NO TOOL CALL: model=${servedModel} ` +
                  `steps=${stepCount} textLen=${text.length} ` +
                  `text="${text.slice(0, 80).replace(/\n/g, " ")}" ` +
                  `— model refused or failed to produce output. The user's request ` +
                  `may require a tool the model didn't choose to call. ` +
                  `Check tool modelDescription strength and model capability.`,
              );
            }

            // ─── Record observability trace ──────────────────────────────────
            if (!traceRecorded) {
              traceRecorded = true;
              const ev = event as any;
              const tu = ev.totalUsage;
              const inTok = tu?.inputTokens ?? (ev.steps || []).reduce((s: number, st: any) => s + (st.usage?.inputTokens ?? 0), 0);
              const outTok = tu?.outputTokens ?? (ev.steps || []).reduce((s: number, st: any) => s + (st.usage?.outputTokens ?? 0), 0);
              const finishReason = (ev.finishReason as string) || (ev.finishReason === undefined ? "unknown" : String(ev.finishReason));
              let status: "success" | "error" | "aborted" | "truncated" = "success";
              if (finishReason === "abort") status = "aborted";
              else if (finishReason === "error") status = "error";
              else if (text.trim().length < 40 && stepCount > 1) status = "truncated";
              const lastMsg = messages[messages.length - 1];
              const inputChars = lastMsg?.role === "user" ? (lastMsg.content || "").length : undefined;
              recordTrace({
                conversationId,
                userId,
                model: servedModel,
                promptTokens: inTok,
                completionTokens: outTok,
                latencyMs: Date.now() - requestStartedAt,
                firstTokenMs: firstTokenAt ? firstTokenAt - requestStartedAt : null,
                steps: stepCount,
                finishReason,
                status,
                inputChars,
                outputChars: text.length,
                toolCalls: toolCallsSeen,
              });
            }
          },
        });

        console.log(
          `[chat] model=${servedModel} tools=${Object.keys(aiTools).join(",")} ` +
            `kbId=${kbId || "none"} activeToolIds=${[...activeToolIds].join(",")} ` +
            `mode=${toolMode} chatOnlyMode=${chatOnlyMode} ` +
            `supportsTools=${modelConfig.supportsTools} useTools=${useTools}`,
        );

        // The AI SDK swallows stream errors into a generic "An error
        // occurred." by default so server error details aren't leaked to the
        // client. Auth failures happen mid-stream (after headers are already
        // sent, so the try/catch below never sees them) — surface a message
        // the user can actually act on instead of a silent/opaque toast.
        const onStreamError = (streamError: unknown) => {
          const rawMsg =
            streamError instanceof Error ? streamError.message : String(streamError);
          console.error(`[chat] stream error on ${servedModel}:`, rawMsg);
          return friendlyProviderErrorMessage(rawMsg, { servedModel, isOllama }) ?? rawMsg;
        };

        // Generative UI is always on, so every response goes through pipeJsonRender,
        // which splits prose from JSONL patches into `text`/`data-spec` parts.
        const response = createUIMessageStreamResponse({
          stream: createUIMessageStream({
            execute: ({ writer }) => {
              // The inner stream's onFinish runs after the inner stream closes, so it can't write
              // to it: it writes its "compressing" status to this outer one, which is still open.
              writer.merge(
                createUIMessageStream({
                  execute: ({ writer: inner }) => {
                    // `toUIMessageStream` needs its own onError: it turns `error` parts into
                    // text itself, so createUIMessageStream's onError never sees them.
                    inner.merge(
                      pipeJsonRender(
                        result
                          .toUIMessageStream({ onError: onStreamError })
                          .pipeThrough(dropRepeatedToolCalls(continuing))
                          .pipeThrough(queuedMarkerTransform(pendingMarkers)),
                      ),
                    );
                  },
                  onError: onStreamError,
                  generateId: () => assistantMessageId,
                  // Starts the stream under the continued message's id and builds its parts from it.
                  originalMessages: messages,
                  // Runs on a normal finish, an error and an abort (Stop). It is the only place the
                  // reply is saved, and it is awaited: the stream closes only after the save and
                  // any auto-compress, so the client's refresh sees the new compressedAt.
                  onFinish: async ({ messages: finishedMessages, isAborted }) => {
                    if (!conversationId) return;
                    const last = finishedMessages[finishedMessages.length - 1];
                    // Stopped before anything streamed: there is no reply to save.
                    const nothingToSave = isAborted && !last?.parts.some((p) => p.type !== "step-start");
                    // No captured event means the stream errored before finishing.
                    const event = { steps: [], ...capturedFinishEvent };
                    const saved =
                      !nothingToSave &&
                      (await safePersistAssistantMessage(event, {
                        conversationId,
                        model: servedModel,
                        systemPrompt: finalSystemPrompt,
                        messageId: assistantMessageId,
                        updateExisting: !!continuing,
                        // A stopped reply saves its open approval cards as denied, so they can't be answered later.
                        overrideParts: isAborted ? denyOpenApprovals(last?.parts ?? []) : (last?.parts ?? []),
                      }));
                    // A claimed message counts as delivered only if the saved reply holds its marker;
                    // a failed save releases every claim.
                    await releaseUnshown(claimedIds, saved ? (last?.parts ?? []) : []).catch((e) =>
                      console.error("[queue] releasing unshown messages failed:", e),
                    );
                    if (saved && canAutoCompress(event, isAborted)) {
                      await autoCompress(
                        conversationId,
                        autoCompressThreshold ?? 85,
                        modelConfig ? contextWindowFor(servedModel, modelConfig, contextLength) : null,
                        () =>
                        writer.write({ type: "data-compressing", data: true, transient: true }),
                      );
                    }
                  },
                }),
              );
            },
            onError: onStreamError,
          }),
        });

        // Stop: onFinish above saves the partial reply. This only records the trace, since
        // streamText's own onFinish doesn't run on an abort.
        if (conversationId && req.signal) {
          req.signal.addEventListener(
            "abort",
            () => {
              if (!traceRecorded) {
                traceRecorded = true;
                const lastMsg = messages[messages.length - 1];
                const inputChars = lastMsg?.role === "user" ? (lastMsg.content || "").length : undefined;
                recordTrace({
                  conversationId,
                  userId,
                  model: servedModel,
                  promptTokens: 0,
                  completionTokens: 0,
                  latencyMs: Date.now() - requestStartedAt,
                  firstTokenMs: firstTokenAt ? firstTokenAt - requestStartedAt : null,
                  steps: undefined,
                  finishReason: "abort",
                  status: "aborted",
                  inputChars,
                  outputChars: partialText.length,
                  toolCalls: toolCallsSeen,
                });
              }
            },
            { once: true },
          );
        }

        // Add debug headers visible in the browser network tab so you can
        // see what settings the server is actually using for this request.
        const debugHeaders = new Headers(response.headers);
        debugHeaders.set("X-Debug-Model", servedModel);
        debugHeaders.set("X-Debug-Chat-Only-Mode", String(chatOnlyMode));
        debugHeaders.set("X-Debug-Tool-Mode", toolMode);
        debugHeaders.set("X-Debug-Supports-Tools", String(modelConfig.supportsTools));
        debugHeaders.set("X-Debug-Use-Tools", String(useTools));
        debugHeaders.set(
          "X-Debug-Tools",
          Object.keys(aiTools).join(",") || "none",
        );
        debugHeaders.set(
          "X-Debug-Active-Tool-Ids",
          [...activeToolIds].join(",") || "none",
        );

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: debugHeaders,
        });
      } catch (err: unknown) {
        lastError = err;
        const errMsg = err instanceof Error ? err.message : String(err);
        if (
          isOllama &&
          attempt === 0 &&
          conversationId &&
          errMsg.includes("available context size")
        ) {
          const nextCtx = getNextContextTier(contextLength ?? modelConfig.contextWindow);
          if (nextCtx) {
            contextLength = nextCtx;
            ollamaOptions.num_ctx = nextCtx;
            console.log(
              `[ctx] ${conversationId} context overflow — retrying with ctx=${nextCtx}`,
            );
            await prisma.conversation.update({
              where: { id: conversationId },
              data: { contextLength: nextCtx },
            });
            continue;
          }
        }
        // Auth/invalid-key errors → friendly message instead of raw 401
        const friendlyAuthMsg = friendlyProviderErrorMessage(errMsg, { servedModel, isOllama });
        if (friendlyAuthMsg) {
          lastError = new Error(friendlyAuthMsg);
          break;
        }
        // Transient provider errors (rate limit, timeout, 5xx, network blip):
        // back off and retry the SAME candidate before giving up on it.
        if (isTransientProviderError(errMsg) && attempt < RETRIES_PER_MODEL - 1) {
          const delay = 400 * Math.pow(2, attempt);
          console.warn(
            `[chat] transient error on ${servedModel} (attempt ${attempt + 1}) — ` +
              `retrying in ${delay}ms: ${errMsg.slice(0, 160)}`,
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        console.error(`[chat] ${servedModel} failed after retries:`, errMsg);
        break;
      }
    }
    }
    throw lastError;
  } catch (error) {
    releaseCliRuns();
    console.error("Chat API error:", error);
    const msg = error instanceof Error ? error.message : "Failed to process chat request";
    if (!traceRecorded) {
      traceRecorded = true;
      recordTrace({
        conversationId,
        userId,
        model: model || bodyModel || "unknown",
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: Date.now() - requestStartedAt,
        status: "error",
        errorMsg: msg,
        inputChars: messages?.[messages.length - 1]?.role === "user"
          ? (messages[messages.length - 1].content || "").length
          : undefined,
      }).catch(() => {});
    }
    return new Response(
      JSON.stringify({ error: msg }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
