import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { RootState } from '../store';

interface Message {
  id: number;
  text: string;
  sender: string;
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
      });
    },
    setCurrentSessionId: (state, action: PayloadAction<number | null>) => {
      state.currentSessionId = action.payload;
    },
  },
});

export const {
  createSession,
  deleteSession,
  sendMessage,
  setCurrentSessionId,
} = chatSlice.actions;

export const selectSessions = (state: RootState) => state.chat.sessions;
export const selectCurrentSessionId = (state: RootState) =>
  state.chat.currentSessionId;

export default chatSlice.reducer;
