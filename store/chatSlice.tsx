import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type MessageType = {
  id: string;
  role: 'user' | 'bot';
  message: string;
};

interface ChatState {
  messages: Record<string, MessageType>;
}

const initialState: ChatState = {
  messages: {},
};

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    addMessage: (state, action: PayloadAction<MessageType>) => {
      state.messages[action.payload.id] = action.payload;
    },
    deleteMessage: (state, action: PayloadAction<string>) => {
      delete state.messages[action.payload];
    },
    clearChat: (state) => {
      state.messages = {};
    },
    editMessage: (
      state,
      action: PayloadAction<{ id: string; editedMessage: string }>
    ) => {
      const { id, editedMessage } = action.payload;
      if (state.messages[id]) {
        state.messages[id].message = editedMessage;
      }
    },
  },
});

export const { addMessage, deleteMessage, editMessage, clearChat } =
  chatSlice.actions;

export default chatSlice.reducer;
