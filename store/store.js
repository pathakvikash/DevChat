import { configureStore } from '@reduxjs/toolkit';
import rootReducer from './reducer/rootreducer';
import themeReducer from './themeSlice';

const store = configureStore({
  reducer: {
    theme: themeReducer,
    root: rootReducer,
  },
});

export default store;
