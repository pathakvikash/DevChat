import { convertToModelMessages, streamText, stepCountIs } from "ai";
import { prisma } from "@/lib/db";
import { getModel } from "@/lib/models";
import { extractText, stripFileParts } from "@/lib/utils/messageParts";
import {
  buildSystemPrompt,
} from "@/lib/chat/buildSystemPrompt";
import {
  buildTools,
  resolveActiveToolIds,
  type ToolSet,
  type ToolMode,
} from "@/lib/chat/buildTools";
import { safePersistAssistantMessage } from "@/lib/chat/persistAssistantMessage";
import { normalizeMessageToolParts } from "@/lib/chat/normalizeToolParts";
import {
  isTransientProviderError,
  friendlyProviderErrorMessage,
  formatMissingApiKeyMessage,
} from "@/lib/chat/providerErrors";
import { resolveChatSettings } from "@/lib/chat/resolveChatSettings";
import { resolveModelCandidates } from "@/lib/chat/resolveModelCandidates";
import { recordTrace } from "@/lib/observability";
import {
  estimatePromptTokens,
  shouldIncreaseContext,
  getNextContextTier,
} from "@/lib/contextManager";
import { requireUserId } from "@/lib/auth";

export async function POST(req: Request) {
  const requestStartedAt = Date.now();
  let traceRecorded = false;
  const userId = await requireUserId();
  const {
    messages,
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
    openrouterApiKey: bodyOpenrouterApiKey,
    nvidiaNimApiKey: bodyNvidiaNimApiKey,
    messageId: bodyUserMessageId,
    assistantMessageId: bodyAssistantMessageId,
    mode: bodyMode,
  } = await req.json();
  // Anything that isn't "agent" falls back to chat, the safer of the two.
  const toolMode: ToolMode = bodyMode === "agent" ? "agent" : "chat";
  let model: string | undefined = bodyModel;
  try {
    if (conversationId) {
      const owned = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { userId: true },
      });
      if (!owned || owned.userId !== userId) {
        return new Response(JSON.stringify({ error: "Conversation not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    const settings = await resolveChatSettings({
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
    });
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
    } = settings;
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
      bodyOpenrouterApiKey,
      bodyNvidiaNimApiKey,
      userId,
    });
    if (!resolution.ok) {
      return new Response(
        JSON.stringify({ error: formatMissingApiKeyMessage(resolution.missingKeyProvider) }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    model = resolution.model;
    const candidateModels = resolution.candidateModels;

    let lastError: unknown;
    for (const servedModel of candidateModels) {
    let modelConfig: ReturnType<typeof getModel> | null = null;
    try {
      modelConfig = getModel(servedModel);
    } catch {
      console.error(
        `[chat] model config unavailable for ${servedModel} — skipping fallback candidate`,
      );
      continue;
    }
    if (!maxTokens) maxTokens = 8192;
    const useTools = modelConfig.supportsTools && !chatOnlyMode;
    const activeToolIds = resolveActiveToolIds(explicitToolIds, skillIds, kbId);

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
    });

    console.log(
      `[chat prompt sections] base=${(sections.base?.length || 0)}ch ` +
        `persona=${(sections.persona?.length || 0)}ch ` +
        `skills=${(sections.skills?.length || 0)}ch ` +
        `tools=${(sections.tools?.length || 0)}ch ` +
        `memory=${(sections.memory?.length || 0)}ch ` +
        `compressed=${(sections.compressed?.length || 0)}ch ` +
        `kb=${(sections.kb?.length || 0)}ch`,
    );

    const sanitizedMessages = normalizeMessageToolParts(
      (Array.isArray(messages) ? messages : []).filter(
        (m: any) => m && m.role !== "compression",
      ),
    );
    const modelMessages = await convertToModelMessages(sanitizedMessages);

    if (conversationId) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.role === "user") {
        const userText = extractText(lastMsg);
        const lastSaved = await prisma.message.findFirst({
          where: { conversationId, role: "user" },
          orderBy: { createdAt: "desc" },
        });
        if (!lastSaved || lastSaved.content !== userText) {
          await prisma.message.create({
            data: {
              ...(bodyUserMessageId ? { id: bodyUserMessageId } : {}),
              conversationId,
              role: "user",
              content: userText,
              parts: JSON.stringify(
                stripFileParts(lastMsg.parts || [{ type: "text", text: userText }]),
              ),
              attachments:
                Array.isArray(bodyAttachments) && bodyAttachments.length > 0
                  ? JSON.stringify(bodyAttachments)
                  : null,
            },
          });
        }
      }
    }

    const aiTools: ToolSet = useTools
      ? await buildTools({ activeToolIds, searchProvider, conversationId, userId, mode: toolMode })
      : {};

    const isOllama = servedModel.startsWith("ollama/");

    // Dynamic context management: estimate prompt tokens and bump the
    // Ollama context window before the request if we're approaching the
    // current tier limit.
    if (isOllama && conversationId) {
      const currentCtx = contextLength ?? 4096;
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

    // Per-candidate retry loop (transient errors + Ollama context overflow).
    const RETRIES_PER_MODEL = 2;
    // Tracks partial assistant output so we can persist it if the client
    // stops the stream mid-generation (onFinish won't fire in that case).
    let assistantPersisted = false;
    let traceRecorded = false;
    let partialText = "";
    const partialParts: any[] = [];
    const partialToolOutputs = new Map<string, { name: string; input: any; start: number }>();
    // Per-tool observations (name/input/output/latency) collected during streaming.
    const toolCallsSeen: { toolName: string; input?: any; output?: any; ok: boolean; latencyMs?: number }[] = [];
    let firstTokenAt: number | null = null;
    for (let attempt = 0; attempt < RETRIES_PER_MODEL; attempt++) {
      try {
        partialText = "";
        partialParts.length = 0;
        partialToolOutputs.clear();
        toolCallsSeen.length = 0;
        firstTokenAt = null;
        const result = streamText({
          model: modelConfig.model,
          system: finalSystemPrompt,
          messages: modelMessages,
          temperature,
          topP,
          // Break the loop if the model calls the SAME tool with the SAME
          // arguments twice in a row. llama3.2 in particular will keep
          // re-issuing a failed tool call up to 3 times; we'd rather have
          // a one-shot failure than an infinite retry storm.
          prepareStep: ({ steps, stepNumber }) => {
            if (steps.length < 2) return undefined;
            const prev = steps[steps.length - 1] as {
              toolCalls?: Array<{ toolName: string; input?: unknown; args?: unknown }>;
            };
            const prev2 = steps[steps.length - 2] as {
              toolCalls?: Array<{ toolName: string; input?: unknown; args?: unknown }>;
            };
            if (!prev?.toolCalls?.length || !prev2?.toolCalls?.length) return undefined;
            const a = prev.toolCalls[0];
            const b = prev2.toolCalls[0];
            if (a.toolName !== b.toolName) return undefined;
            const aArgs = JSON.stringify(a.input ?? a.args ?? {});
            const bArgs = JSON.stringify(b.input ?? b.args ?? {});
            if (aArgs === bArgs) {
              console.warn(
                `[chat] Model called ${a.toolName} with identical args on ` +
                  `steps ${stepNumber - 1} and ${stepNumber} — breaking loop.`,
              );
              throw new Error(
                `Tool "${a.toolName}" was called twice with identical arguments. ` +
                  `Stopping to avoid a retry loop.`,
              );
            }
            return undefined;
          },
          stopWhen: ({ steps }) => {
            if (steps.length >= maxToolCalls) return true;
            const last = steps[steps.length - 1] as
              | {
                  text?: string;
                  content?: Array<{ type: string }>;
                  toolCalls?: unknown[];
                  toolResults?: unknown[];
                }
              | undefined;
            if (!last) return true;
            const text = (last.text ?? "").trim();
            const hadToolResult =
              (last.toolResults?.length ?? 0) > 0 ||
              (last.content ?? []).some(
                (p) => (p as { type?: string }).type === "tool-result",
              );
            // Break tool-only loops: if the model has done 2+ steps in a row
            // with no text (only tool calls), stop so it doesn't exhaust its
            // step budget on repeated searches without ever writing an answer.
            if (steps.length >= 3) {
              const recent = steps.slice(-3) as Array<{
                text?: string;
                toolCalls?: unknown[];
              }>;
              const allToolOnly = recent.every(
                (s) => (s.text ?? "").trim().length < 20 && (s.toolCalls?.length ?? 0) > 0,
              );
              if (allToolOnly) {
                console.warn(
                  `[chat] 3 consecutive tool-only steps — stopping to avoid ` +
                    `tool loop. Last text="${text.slice(0, 60).replace(/\n/g, " ")}"`,
                );
                return true;
              }
            }
            // Local models (qwen3.5, llama3.1, etc.) often emit their chat
            // template's stop token right after tool results, even after we've
            // told them to "complete your response". The reliable workaround
            // is to NOT honor that premature stop: keep the loop going, feed
            // the model's own short text back in on the next step, and let it
            // continue from where it cut off ("Based" → "Based on the …").
            if (hadToolResult && text.length < 60) {
              console.warn(
                `[chat] Short response (${text.length} chars) after tool ` +
                  `result — forcing continuation. text="${text.slice(0, 60).replace(/\n/g, " ")}"`,
              );
              return false;
            }
            // qwen and other small local models sometimes emit just "..." or a
            // bare stop token with no tool call at all. Force one continuation
            // on step 0/1 so the SDK can re-prompt; cap at 2 retries.
            if (!hadToolResult && text.length < 30 && steps.length <= 2) {
              console.warn(
                `[chat] Near-empty response (${text.length} chars) with no tool ` +
                  `call on step ${steps.length} — forcing continuation. ` +
                  `text="${text.slice(0, 60).replace(/\n/g, " ")}"`,
              );
              return false;
            }
            return true;
          },
          tools: aiTools,
          toolChoice: "auto",
          maxRetries: 0,
          abortSignal: req.signal,
          ...(isOllama ? { providerOptions: { ollama: ollamaOptions } } : {}),
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
              partialParts.push({
                type: `tool-${chunk.toolName}`,
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName,
                input: chunk.input ?? {},
                state: "output-available",
              });
            } else if (chunk.type === "tool-result") {
              const meta = partialToolOutputs.get(chunk.toolCallId);
              const latencyMs = meta?.start ? Date.now() - meta.start : undefined;
              toolCallsSeen.push({
                toolName: chunk.toolName,
                input: meta?.input,
                output: chunk.output,
                ok: true,
                latencyMs,
              });
              const idx = partialParts.findIndex(
                (p) => p.toolCallId === chunk.toolCallId,
              );
              if (idx >= 0 && partialParts[idx]) {
                partialParts[idx] = {
                  ...partialParts[idx],
                  output: chunk.output,
                  state: "result",
                };
              }
            }
          },
          onFinish: (event) => {
            if (!conversationId) return;
            assistantPersisted = true;
            safePersistAssistantMessage(event, { conversationId, model: servedModel, autoCompressThreshold, systemPrompt: finalSystemPrompt, messageId: bodyAssistantMessageId });

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
            `mode=${toolMode} chatOnlyMode=${chatOnlyMode} supportsTools=${modelConfig.supportsTools} ` +
            `useTools=${useTools}`,
        );

        // The AI SDK swallows stream errors into a generic "An error
        // occurred." by default so server error details aren't leaked to the
        // client. Auth failures happen mid-stream (after headers are already
        // sent, so the try/catch below never sees them) — surface a message
        // the user can actually act on instead of a silent/opaque toast.
        const response = result.toUIMessageStreamResponse({
          onError: (streamError) => {
            const rawMsg =
              streamError instanceof Error ? streamError.message : String(streamError);
            console.error(`[chat] stream error on ${servedModel}:`, rawMsg);
            return friendlyProviderErrorMessage(rawMsg, { servedModel, isOllama }) ?? rawMsg;
          },
        });

        // If the client stops the generation, onFinish may not fire. Persist
        // whatever partial content we've accumulated so it isn't lost on refresh.
        if (conversationId && req.signal) {
          req.signal.addEventListener(
            "abort",
            () => {
              if (assistantPersisted) return;
              assistantPersisted = true;
              const parts =
                partialParts.length > 0
                  ? partialParts
                  : partialText
                    ? [{ type: "text", text: partialText }]
                    : [];
              if (parts.length === 0) return;
              safePersistAssistantMessage(
                {
                  steps: [
                    {
                      text: partialText,
                      toolCalls: partialParts
                        .filter((p) => p.toolName)
                        .map((p) => ({ toolCallId: p.toolCallId, toolName: p.toolName, input: p.input })),
                      toolResults: partialParts
                        .filter((p) => p.state === "result")
                        .map((p) => ({ toolCallId: p.toolCallId, toolName: p.toolName, output: p.output })),
                    },
                  ],
                  totalUsage: undefined,
                },
                { conversationId, model: servedModel, autoCompressThreshold, systemPrompt: finalSystemPrompt, messageId: bodyAssistantMessageId },
              );

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
          const nextCtx = getNextContextTier(contextLength ?? 4096);
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
