import { combineReducers } from 'redux';
import chatSlice from '../slice/chatSlice';
const rootReducer = combineReducers({
  chat: chatSlice,
});

export default rootReducer;
