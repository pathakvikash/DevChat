import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface Session {
  id: string;
  name: string;
  messages: Record<string, any>;
}

export interface SessionsState {
  sessions: Record<string, Session>;
  currentSessionId: string | null;
}

const initialState: SessionsState = {
  sessions: {},
  currentSessionId: null,
};

const sessionsSlice = createSlice({
  name: 'sessions',
  initialState,
  reducers: {
    addSession: (state, action: PayloadAction<Session>) => {
      state.sessions[action.payload.id] = action.payload;
      state.currentSessionId = action.payload.id;
    },
    setCurrentSession: (state, action: PayloadAction<string>) => {
      state.currentSessionId = action.payload;
    },
    clearCurrentSession: (state) => {
      state.sessions = {};
    },
    editSessionName: (
      state,
      action: PayloadAction<{ sessionId: string; newName: string }>
    ) => {
      const { sessionId, newName } = action.payload;
      if (state.sessions[sessionId]) {
        state.sessions[sessionId].name = newName;
      }
    },
    saveMessage: (
      state,
      action: PayloadAction<{ sessionId: string; message: any }>
    ) => {
      const { sessionId, message } = action.payload;

      // Check if the session exists
      if (state.sessions[sessionId]) {
        // If the session exists, update the messages with the new message
        const updatedMessages = {
          ...state.sessions[sessionId].messages,
          [message.id]: message,
        };
        state.sessions[sessionId].messages = updatedMessages;
      } else {
        // If the session doesn't exist, create a new session with the new message
        state.sessions[sessionId] = {
          id: sessionId,
          name: '',
          messages: { [message.id]: message },
        };
      }
    },

    deleteSession: (state, action: PayloadAction<string>) => {
      const { [action.payload]: deletedSession, ...remainingSessions } =
        state.sessions;
      state.sessions = remainingSessions;
      state.currentSessionId = null;
    },
  },
});

export const {
  addSession,
  setCurrentSession,
  clearCurrentSession,
  editSessionName,
  deleteSession,
  saveMessage,
} = sessionsSlice.actions;
export default sessionsSlice.reducer;
