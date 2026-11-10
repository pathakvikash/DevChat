import type { MinimapMessage } from "@/app/components/MinimapNavigator";
import type { Conversation } from "@/app/components/conversation/types";
import type { ChatMode } from "@/lib/chat/modes";
import type { DataActions } from "./useConversationData";
import type { QuoteCard } from "@/lib/utils/quoteReply";
import type { QueuedItem } from "@/app/components/QueuedMessages";
import type { ApprovalAnswer, PlanAnswer } from "@/app/components/ToolAnswers";
import type { ModelCaps } from "@/app/contexts/ChatModeContext";

/** Everything one chat pane needs (see useChatPane). Page-wide values are not in here. */
export interface ChatPaneState extends DataActions {
  conversation: Conversation | null;
  setConversation: React.Dispatch<React.SetStateAction<Conversation | null>>;
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  /** Suggested next message shown greyed in the box after a reply. */
  suggestion: string | null;
  setSuggestion: React.Dispatch<React.SetStateAction<string | null>>;
  files: File[];
  setFiles: React.Dispatch<React.SetStateAction<File[]>>;
  /** Working-folder paths picked with `@`. */
  mentions: string[];
  setMentions: React.Dispatch<React.SetStateAction<string[]>>;
  mentionCuts: Record<string, { kept: number; total: number }>;
  quotes: QuoteCard[];
  addQuote: (text: string, dictate?: boolean) => void;
  askSide: (text: string) => Promise<void>;
  moveQuoteToSide: (id: string) => Promise<void>;
  dictateQuoteId: string | null;
  setDictateQuoteId: React.Dispatch<React.SetStateAction<string | null>>;
  updateQuote: (id: string, instruction: string) => void;
  removeQuote: (id: string) => void;
  sendQuote: (id: string) => Promise<void>;
  sendComposed: () => Promise<void>;
  /** Messages typed during a reply, waiting for the server to take them. */
  queued: QueuedItem[];
  queueMessage: () => void;
  editQueued: (id: string, text: string) => Promise<void>;
  removeQueued: (id: string) => Promise<void>;
  retryQueued: (id: string) => void;
  /** Text for the pane's polite live region. */
  announcement: string;
  toggleTemporary: () => Promise<void>;
  scratchpadOpen: boolean;
  setScratchpadOpen: React.Dispatch<React.SetStateAction<boolean>>;
  todoPanelOpen: boolean;
  setTodoPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  advancedOpen: boolean;
  setAdvancedOpen: React.Dispatch<React.SetStateAction<boolean>>;
  modelSettingsOpen: boolean;
  setModelSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  artifactPanelOpen: boolean;
  setArtifactPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  selectedArtifactId: string | null;
  setSelectedArtifactId: React.Dispatch<React.SetStateAction<string | null>>;
  contextPanelOpen: boolean;
  setContextPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  contextData: { usedTokens: number; maxContextTokens: number; contextPercent: number } | null;
  setContextData: React.Dispatch<React.SetStateAction<{ usedTokens: number; maxContextTokens: number; contextPercent: number } | null>>;
  toolErrorDialogOpen: boolean;
  setToolErrorDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  keyboardShortcutsOpen: boolean;
  setKeyboardShortcutsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isCompressing: boolean;
  compressFocus: string;
  setIsCompressing: React.Dispatch<React.SetStateAction<boolean>>;
  enabledTools: string[];
  enabledSkills: string[];
  persistAdvanced: (next: { enabledTools: string[]; enabledSkills: string[] }) => void;
  selectedKbId: string;
  setSelectedKbId: React.Dispatch<React.SetStateAction<string>>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  toast: (msg: string, type: "success" | "error" | "info") => void;
  messages: any[];
  sendMessage: any;
  status: string;
  stop: () => void;
  regenerate: any;
  error: Error | undefined;
  setMessages: React.Dispatch<React.SetStateAction<any[]>>;
  addToolResult: any;
  isLoading: boolean;
  currentModelName: string;
  handleClarificationAnswer: (toolCallId: string, answer: string) => Promise<void>;
  answerApproval: (answer: ApprovalAnswer) => void;
  answerPlan: (answer: PlanAnswer) => void;
  approvePlanReply: () => void;
  allowedToolCount: number;
  resetAllowedTools: () => void;
  mode: ChatMode;
  setMode: (next: ChatMode) => void;
  modelCaps: ModelCaps;
  setModelCaps: (next: ModelCaps) => void;
  /** Opens or closes this chat's side chat pane. */
  toggleSidePane: () => void;
  /** Tool-less "Send to…": this chat's reply goes to another open chat as an agent message. */
  sendToPane: (targetId: string, text: string) => void;
  /** A sub-agent transcript: read only, never a message target. */
  isSubagent: boolean;
  /** False for a model without tools (or chat-only): queued messages go next, and Ask and Plan get their text fallbacks. */
  toolsAvailable: boolean;
  handleEditMessage: (messageId: string, content: string) => Promise<void>;
  handleDeleteMessage: (messageId: string) => Promise<void>;
  handleCopyMessage: (content: string) => void;
  handleForkMessage: (messageId: string) => Promise<void>;
  handleRegenerateMessage: (messageId: string) => void;
  handleRegenExecute: (mode: "retry" | "think" | "search", additionalInput: string) => Promise<void>;
  regenModal: {
    type: "retry" | "message";
    messageId?: string;
    userMessageText: string;
    userCreatedAt?: string;
    userMessageIdx?: number;
  } | null;
  setRegenModal: (v: any) => void;
  handleSubmit: (e?: { preventDefault(): void }) => Promise<void>;
  minimapMessages: MinimapMessage[];
  isDialogOpen: boolean;
  closeTopDialog: () => void;
}
