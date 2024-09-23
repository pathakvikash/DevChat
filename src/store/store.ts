import { configureStore } from '@reduxjs/toolkit';
import chatReducer from './slice/chatSlice';
import workspaceReducer from './slice/workspaceSlice';
import themeReducer from './slice/themeSlice';

export const store = configureStore({
  reducer: {
    chat: chatReducer,
    workspace: workspaceReducer,
    theme: themeReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
