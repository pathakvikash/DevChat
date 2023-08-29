import { useDispatch, useSelector } from 'react-redux';
import {
  addMessage,
  deleteMessage,
  editMessage,
  clearChat,
} from '../../store/chatSlice';
import {
  addSession,
  deleteSession,
  setCurrentSession,
  saveMessage,
} from '../../store/sessionsSlice';

import { MessageType } from '../../store/chatSlice';
import { Session } from '../../store/sessionsSlice';

export const useChat = () => {
  const dispatch = useDispatch();
  const messages = useSelector((state: any) => state.root.chat.messages);

  const addChatMessage = (message: MessageType) => {
    dispatch(addMessage(message));
  };

  const deleteChatMessage = (id: string) => {
    dispatch(deleteMessage(id));
  };

  const editChatMessage = (id: string, editedMessage: string) => {
    dispatch(editMessage({ id, editedMessage }));
  };

  const clearChatMessages = () => {
    dispatch(clearChat());
    console.log('clear');
  };

  return {
    messages,
    addChatMessage,
    deleteChatMessage,
    editChatMessage,
    clearChatMessages,
  };
};

export const useSessions = () => {
  const dispatch = useDispatch();
  const sessions = useSelector((state: any) => state.root.sessions.sessions);

  const currentSessionId = useSelector(
    (state: any) => state.root.sessions.currentSessionId
  );

  const { clearChatMessages } = useChat();
  const addChatSession = (session: Session) => {
    dispatch(addSession(session));
    clearChatMessages();
  };

  const deleteChatSession = (id: string) => {
    dispatch(deleteSession(id));
    clearChatMessages();
  };

  const setCurrentChatSession = (id: string) => {
    dispatch(setCurrentSession(id));
  };

  const saveChatMessage = (
    sessionId: string,
    messages: Record<string, any>
  ) => {
    dispatch(saveMessage({ sessionId, message: messages }));
  };

  return {
    sessions,
    currentSessionId,
    addChatSession,
    deleteChatSession,
    setCurrentChatSession,
    saveChatMessage,
  };
};
