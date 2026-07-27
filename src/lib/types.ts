export type MessageRole = "user" | "assistant" | "system";

export interface Attachment {
  id: string;
  file: File;
  preview?: string;
  type: "image" | "file";
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  attachments?: Attachment[];
  timestamp: Date;
  isStreaming?: boolean;
}

export interface StreamingState {
  isLoading: boolean;
  canStop: boolean;
  canRetry: boolean;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface RAGChunk {
  text: string;
  embedding: number[];
  index: number;
}

export interface DocumentMetadata {
  filename: string;
  uploadedAt: string;
  size: number;
}
