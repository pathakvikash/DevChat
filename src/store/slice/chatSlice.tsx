import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { RootState } from '../store';

interface Message {
  id: number;
  text: string;
  sender: string;
  isComplete: boolean;
}

export interface Session {
  id: number;
  name: string;
  messages: Message[];
}

interface ChatState {
  sessions: Session[];
  currentSessionId: number | null;
}

const initialState: ChatState = {
  sessions: [],
  currentSessionId: null,
};

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    createSession: (state) => {
      const newSessionId = state.sessions.length + 1;
      state.sessions.push({
        id: newSessionId,
        name: 'Untitled Conversation',
        messages: [],
      });
      state.currentSessionId = newSessionId;
    },
    deleteSession: (state, action: PayloadAction<number>) => {
      state.sessions = state.sessions.filter(
        (session) => session.id !== action.payload
      );
      state.currentSessionId = null;
    },
    sendMessage: (
      state,
      action: PayloadAction<{ sessionId: number; text: string; role: string }>
    ) => {
      const { sessionId, text, role } = action.payload;
      const newMessageId = state.sessions[sessionId - 1].messages.length + 1;
      state.sessions[sessionId - 1].messages.push({
        id: newMessageId,
        text,
        sender: role,
        isComplete: role === 'user',
      });
    },
    setCurrentSessionId: (state, action: PayloadAction<number | null>) => {
      state.currentSessionId = action.payload;
    },

    setSessionName: (
      state,
      action: PayloadAction<{ sessionId: number; name: string }>
    ) => {
      const { sessionId, name } = action.payload;
      const session = state.sessions.find((s) => s.id === sessionId);
      if (session) {
        session.name = name;
      }
    },
    /**
     * Updates the last message in the given session.
     *
     * @param state the current state of the chat
     * @param action the action containing the session ID, optional text, and isComplete boolean
     */
    updateLastMessage: (
      state,
      action: PayloadAction<{
        sessionId: number;
        messageId?: number;
        text?: string;
        isComplete: boolean;
      }>
    ) => {
      const { sessionId, messageId, text, isComplete } = action.payload;
      const session = state.sessions.find((s) => s.id === sessionId);
      if (session) {
        const targetMessage = messageId
          ? session.messages.find(m => m.id === messageId)
          : session.messages[session.messages.length - 1];
        if (targetMessage && targetMessage.sender === 'server') {
          if (text !== undefined) {
            targetMessage.text = text;
          }
          targetMessage.isComplete = isComplete;
        }
      }
    },
    editMessage: (
      state,
      action: PayloadAction<{
        sessionId: number;
        messageId: number;
        text: string;
      }>
    ) => {
      const { sessionId, messageId, text } = action.payload;
      const session = state.sessions.find((s) => s.id === sessionId);
      if (session) {
        const message = session.messages.find((m) => m.id === messageId);
        if (message) {
          message.text = text;
        }
      }
    },
    removeMessagesAfter: (
      state,
      action: PayloadAction<{
        sessionId: number;
        messageId: number;
      }>
    ) => {
      const { sessionId, messageId } = action.payload;
      const session = state.sessions.find(s => s.id === sessionId);
      if (session) {
        const messageIndex = session.messages.findIndex(m => m.id === messageId);
        if (messageIndex !== -1) {
          session.messages = session.messages.slice(0, messageIndex + 1);
        }
      }
    },
  },
});

export const {
  createSession,
  deleteSession,
  sendMessage,
  setCurrentSessionId,
  updateLastMessage,
  setSessionName,
  editMessage,
  removeMessagesAfter,
} = chatSlice.actions;

export const selectSessions = (state: RootState) => state.chat.sessions;
export const selectCurrentSessionId = (state: RootState) =>
  state.chat.currentSessionId;

export default chatSlice.reducer;