export interface Conversation {
  id: string;
  title: string;
  model: string;
  persona?: string;
  systemPrompt?: string;
  kbId?: string;
  webSearch: boolean;
  temperature: number;
  maxTokens?: number;
  contextLength?: number;
  topP?: number;
  totalTokens: number;
  note?: string;
  chatOnlyMode?: boolean;
  memoryDisabled?: boolean;
  maxToolCalls?: number;
  fallbackModel?: string | null;
  compressedSummary?: string;
  compressedAt?: string;
  compressedBeforeTokens?: number;
  compressedAfterTokens?: number;
  compressedBeforeMessages?: number;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    model?: string;
    inputTokens: number;
    outputTokens: number;
    createdAt: string;
  }>;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsThinking?: boolean;
  usageCount?: number;
}

export interface ModelGroup {
  provider: string;
  models: ModelInfo[];
}
