import { useSelector, useDispatch } from 'react-redux';
import { addMessage, deleteMessage, editMessage } from '../chatSlice';
import { MessageType } from '../Context/chatContext';

export function useChatMessages() {
  const dispatch = useDispatch();
  const messages = useSelector((state: any) => state.chat.messages);

  const handleAddMessage = (role: 'user' | 'bot', message: string) => {
    const newMessage: MessageType = {
      id: Date.now().toString(),
      role,
      message,
    };
    dispatch(addMessage(newMessage));
  };

  const handleDeleteMessage = (messageId: string) => {
    dispatch(deleteMessage(messageId));
  };

  const handleEditMessage = (messageId: string, editedMessage: string) => {
    dispatch(editMessage({ id: messageId, editedMessage }));
  };

  return { messages, handleAddMessage, handleDeleteMessage, handleEditMessage };
}
