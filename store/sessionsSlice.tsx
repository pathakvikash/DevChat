import { createSlice } from '@reduxjs/toolkit';

export interface Session {
  id: string;
  name: string;
  messages: any[];
}

export interface SessionsState {
  sessions: Session[];
  currentSessionId: string | null;
}

const initialState: SessionsState = {
  sessions: [],
  currentSessionId: null,
};

const sessionsSlice = createSlice({
  name: 'sessions',
  initialState,
  reducers: {
    addSession: (state, action) => {
      state.sessions.push(action.payload);
      state.currentSessionId = action.payload.id;
    },
    setCurrentSession: (state, action) => {
      state.currentSessionId = action.payload;
    },
    clearCurrentSession: (state) => {
      state.currentSessionId = null;
    },
    editSessionName: (state, action) => {
      const { sessionId, newName } = action.payload;
      const session = state.sessions.find(
        (session) => session.id === sessionId
      );
      if (session) {
        session.name = newName;
      }
    },
    deleteSession: (state, action) => {
      state.sessions = state.sessions.filter(
        (session) => session.id !== action.payload
      );
    },
    saveMessage: (state, action) => {
      const { sessionId, message } = action.payload;
      return {
        ...state,
        sessions: state.sessions.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                messages: [...session.messages, message],
              }
            : session
        ),
      };
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
