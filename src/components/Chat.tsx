import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { addMessage } from '../../store/chatSlice';
import { FaUserAstronaut, FaTrash, FaEdit, FaCopy } from 'react-icons/fa';
import { AiOutlineSend } from 'react-icons/ai';
import { CgBot } from 'react-icons/cg';
import { MdDeleteForever } from 'react-icons/md';
import { v4 } from 'uuid';
import { SessionType } from '../app/page';
import ModelSelect from './ModelSelect';
import { saveMessage } from '../../store/sessionsSlice';

export type MessageType = {
  id: string;
  role: 'user' | 'bot';
  message: string;
};

const models = [
  { id: 1, name: 'Open AI' },
  { id: 2, name: 'LLama' },
  { id: 3, name: 'vicuna' },
];

const Chat = () => {
  const [chat, setChat] = useState('');
  const dispatch = useDispatch();
  const [showChatInput, setShowChatInput] = useState(true);
  const theme = useSelector((state: any) => state.theme);
  const currentSessionId = useSelector(
    (state: any) => state.root.sessions.sessions.currentSessionId
  );
  const sessionId: any = localStorage.getItem('sessionId')?.valueOf();
  const currentSession = useSelector((state: any) =>
    state.root.sessions.sessions.find(
      (session: any) => session.id === currentSessionId
    )
  );

  const sessionData = useSelector((state: any) => {
    const chat = state.root.chat;
    return chat ? chat.messages : [];
  });

  const updateSession = (session: SessionType) => {
    if (sessionId) {
      localStorage.setItem(
        sessionId,
        JSON.stringify(session) || (session as any)
      );
    }
  };

  const [messages, setMessages] = useState<MessageType[]>(sessionData);
  const handleAddMessage = (role: 'user' | 'bot', message: string) => {
    if (currentSession && currentSession.sessions.messages) {
      const newMessage: MessageType = {
        id: v4(),
        role,
        message,
      };

      const updatedSession = {
        ...currentSession,
        messages: [...currentSession.sessions.messages, newMessage],
      };

      updateSession(updatedSession);
      setMessages(updatedSession.messages);
      dispatch(addMessage(newMessage));
      dispatch(saveMessage({ sessionId, newMessage }));
    }
  };

  const handleSubmit = () => {
    if (chat.trim() !== '') {
      handleAddMessage('user', chat);
      setTimeout(() => {
        handleAddMessage('bot', `Bot: ${chat}`);
      }, 1000);

      setChat('');
    }
  };

  const handleActionMessage = (
    messageId: string,
    action: 'delete' | 'edit',
    editedMessage?: string
  ) => {
    const sessionData = localStorage.getItem(sessionId);
    if (sessionData) {
      const session: SessionType = JSON.parse(sessionData);
      const updatedMessages = session.messages.filter(
        (message) => message.id !== messageId
      );

      if (action === 'edit' && editedMessage) {
        session.messages = session.messages.map((message) =>
          message.id === messageId
            ? { ...message, message: editedMessage }
            : message
        );
      }

      session.messages = updatedMessages;
      updateSession(session);
      setMessages([...session.messages]);
    }
  };

  useEffect(() => {
    const sessionData = localStorage.getItem(sessionId);
    if (sessionData) {
      const session: SessionType = JSON.parse(sessionData);
      setMessages(session.messages);
    }
  }, [sessionId]);

  return (
    <div
      className={`frame ${theme} flex text-black justify-between flex-col w-full p-6`}
    >
      <div>
        <div className='flex justify-center mt-4'>
          <button
            className='toggleChatInput'
            onClick={() => setShowChatInput(!showChatInput)}
          >
            {showChatInput ? 'Hide Chat Input' : 'Show Chat Input'}
          </button>
        </div>
        <div
          className={`w-full ${
            theme === 'dark' ? 'bg-[#282828]' : 'bg-[white]'
          } rounded-[6px] p-[8px]`}
        >
          <ChatMessages
            // messages={messages}
            handleActionMessage={handleActionMessage}
          />
        </div>
      </div>
      {showChatInput && (
        <div
          className={`rounded-[6px]  ${
            theme === 'dark' ? 'bg-[#1D1D1D]' : 'bg-[#dee1ea]'
          }`}
        >
          <ModelSelect theme={theme} models={models} />
          <div
            className={`flex p-3 rounded-[6px] bg-[#1D1D1D] relative items-center justify-center ${
              theme === 'dark' ? 'bg-[#2E2E2E]' : 'bg-[#dee1ea]'
            }`}
          >
            <input
              placeholder='Ask Anything'
              type='text'
              className={`w-full ${
                theme === 'dark' ? 'bg-[#2E2E2E]' : 'bg-[#dee1ea]'
              } rounded-[6px] px-3 py-2 transition duration-300 focus:outline-none focus:ring-2 focus:ring-blue-500`}
              onChange={(e) => setChat(e.target.value)}
              value={chat}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleSubmit();
                }
              }}
            />

            <div className='absolute right-[10px]' onClick={handleSubmit}>
              <AiOutlineSend />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Chat;
const ChatMessages = ({
  handleActionMessage,
}: {
  handleActionMessage: (
    messageId: string,
    action: 'delete' | 'edit',
    editedMessage?: string
  ) => void;
}) => {
  const theme = useSelector((state: any) => state.theme);
  const messages = useSelector((state: any) => {
    const chat = state.root.chat;
    return chat ? chat.messages : [];
  });

  return (
    <div className={`chat-messages`}>
      {messages.length > 0 ? (
        messages.map((message: MessageType) => (
          <div
            key={message.id}
            className={`message p-[8px] mt-[12px] rounded-[6px] ${
              message.role
            } ${
              theme === 'dark' ? 'bg-[#2E2E2E]' : 'bg-[#dee1ea]'
            }  gap-2 flex ${message.role === 'user' ? '#f0f4f8' : '#ffffff'}`}
            style={{
              boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
              animation: 'fadeInUp 0.5s ease-in-out',
            }}
          >
            {message.role === 'user' ? (
              <div className='user-message flex items-center'>
                <FaUserAstronaut size={24} />
                <div className='message-text'>{message.message}</div>
                <div className='message-actions'>
                  <MdDeleteForever
                    onClick={() => handleActionMessage(message.id, 'delete')}
                    size={20}
                  />
                </div>
              </div>
            ) : (
              <div>
                <div className='bot-message flex items-center'>
                  <CgBot size={24} />
                  <div className='message-text'>{message.message}</div>
                  <div className='message-actions'>
                    <MdDeleteForever
                      onClick={() => handleActionMessage(message.id, 'delete')}
                      size={20}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        ))
      ) : (
        <p>No messages available.</p>
      )}
      <style jsx>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .user-message {
          justify-content: flex-start;
        }

        .bot-message {
          justify-content: flex-end;
        }
      `}</style>
    </div>
  );
};
