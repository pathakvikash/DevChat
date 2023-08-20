import { combineReducers } from 'redux';
import sessionsSlice from '../sessionsSlice';
import chatReducer from '../chatSlice';

const rootReducer = combineReducers({
  chat: chatReducer,
  sessions: sessionsSlice,
});

export default rootReducer;
