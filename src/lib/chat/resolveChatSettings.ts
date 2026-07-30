import { prisma } from "@/lib/db";
import { getSettingsKey } from "@/lib/settings";
import type { SearchProvider } from "@/lib/search";

export interface ResolveChatSettingsOptions {
  conversationId: string | undefined;
  bodyModel: string | undefined;
  bodySystemPrompt: string | undefined;
  bodyTemperature: number | undefined;
  bodyKbId: string | undefined;
  bodySearchProvider: string | undefined;
  bodyEnabledTools: unknown;
  bodyEnabledSkills: unknown;
  bodyChatOnlyMode: boolean | undefined;
  bodyMemoryDisabled: boolean | undefined;
  bodyAutoCompressThreshold: number | undefined;
  bodyMaxToolCalls: number | undefined;
}

export interface ResolvedChatSettings {
  model: string | undefined;
  searchProvider: SearchProvider;
  explicitToolIds: string[];
  skillIds: string[];
  systemPrompt: string | undefined;
  temperature: number;
  kbId: string | undefined;
  contextLength: number | undefined;
  topP: number | undefined;
  maxTokens: number | undefined;
  chatOnlyMode: boolean;
  memoryDisabled: boolean;
  fallbackModel: string | undefined;
  autoCompressThreshold: number;
  maxToolCalls: number;
}

/**
 * Resolves the effective settings for a chat turn by merging request-body
 * defaults with the conversation's saved settings (DB takes precedence when
 * present, falling back to whatever the caller sent).
 */
export async function resolveChatSettings(
  opts: ResolveChatSettingsOptions,
): Promise<ResolvedChatSettings> {
  const bodySP = opts.bodySearchProvider || (await getSettingsKey("searchProvider"));
  const searchProvider: SearchProvider = bodySP === "tavily" ? "tavily" : "duckduckgo";

  const explicitToolIds: string[] = Array.isArray(opts.bodyEnabledTools)
    ? (opts.bodyEnabledTools as string[])
    : [];
  const skillIds: string[] = Array.isArray(opts.bodyEnabledSkills)
    ? (opts.bodyEnabledSkills as string[])
    : [];

  let model = opts.bodyModel;
  let systemPrompt = opts.bodySystemPrompt;
  let temperature = opts.bodyTemperature ?? 0.7;
  let kbId = opts.bodyKbId;
  let contextLength: number | undefined;
  let topP: number | undefined;
  let maxTokens: number | undefined;
  let chatOnlyMode = opts.bodyChatOnlyMode ?? false;
  let memoryDisabled = opts.bodyMemoryDisabled ?? false;
  let fallbackModel: string | undefined;
  const autoCompressThreshold = opts.bodyAutoCompressThreshold ?? 85;
  let maxToolCalls = opts.bodyMaxToolCalls ?? 5;

  if (opts.conversationId) {
    const conv = await prisma.conversation.findUnique({
      where: { id: opts.conversationId },
      select: {
        model: true,
        systemPrompt: true,
        temperature: true,
        kbId: true,
        contextLength: true,
        topP: true,
        maxTokens: true,
        chatOnlyMode: true,
        memoryDisabled: true,
        maxToolCalls: true,
        fallbackModel: true,
      },
    });
    if (conv) {
      model = conv.model || model;
      systemPrompt = conv.systemPrompt || systemPrompt;
      temperature = conv.temperature ?? temperature;
      kbId = conv.kbId || kbId;
      contextLength = conv.contextLength ?? undefined;
      topP = conv.topP ?? undefined;
      maxTokens = conv.maxTokens ?? undefined;
      chatOnlyMode = conv.chatOnlyMode ?? chatOnlyMode;
      memoryDisabled = conv.memoryDisabled ?? memoryDisabled;
      maxToolCalls = conv.maxToolCalls ?? maxToolCalls;
      if (conv.fallbackModel) fallbackModel = conv.fallbackModel;
    }
  }

  return {
    model,
    searchProvider,
    explicitToolIds,
    skillIds,
    systemPrompt,
    temperature,
    kbId,
    contextLength,
    topP,
    maxTokens,
    chatOnlyMode,
    memoryDisabled,
    fallbackModel,
    autoCompressThreshold,
    maxToolCalls,
  };
}
