import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type MessageType = {
  id: string;
  role: 'user' | 'bot';
  message: string;
};

interface ChatState {
  messages: MessageType[];
}

const initialState: ChatState = {
  messages: [],
};

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    addMessage: (state, action: PayloadAction<MessageType>) => {
      state.messages.push(action.payload);
    },
    deleteMessage: (state, action: PayloadAction<string>) => {
      state.messages = state.messages.filter(
        (message) => message.id !== action.payload
      );
    },
    editMessage: (
      state,
      action: PayloadAction<{ id: string; editedMessage: string }>
    ) => {
      const { id, editedMessage } = action.payload;
      const message = state.messages.find((message) => message.id === id);
      if (message) {
        message.message = editedMessage;
      }
    },
  },
});

export const { addMessage, deleteMessage, editMessage } = chatSlice.actions;

export default chatSlice.reducer;
