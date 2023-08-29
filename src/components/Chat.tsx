import React, { useState, useEffect, use, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { addMessage, deleteMessage, editMessage } from '../../store/chatSlice';
import { FaUserAstronaut, FaTrash, FaEdit, FaCopy } from 'react-icons/fa';
import { AiOutlineSend } from 'react-icons/ai';
import { CgBot } from 'react-icons/cg';
import { MdDeleteForever } from 'react-icons/md';
import { v4 } from 'uuid';
import ModelSelect from './ModelSelect';
import { useChat, useSessions } from '../../store/hooks/hook';
import axios from 'axios';
import { sessionId } from '../utils/localstorage';

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
  const [showChatInput, setShowChatInput] = useState(true);
  const dispatch = useDispatch();
  const theme = useSelector((state: any) => state.theme);
  const [chat, setChat] = useState('');
  const [selectedModel, setSelectedModel] = useState(models[0]);
  const { addChatMessage } = useChat();
  const [showPrompt, setShowPrompt] = useState(false);
  const prompts = [
    'create a landing page for a new business',
    'write a blog post',
  ];

  const handleSendMessage = async (role: 'user' | 'bot', message: string) => {
    if (message.trim() !== '') {
      addChatMessage({
        id: v4(),
        role,
        message,
      });
      setChat('');

      try {
        const response = await axios.post(
          'http://localhost:5000/api/chat/completions' ||
            `${process.env.BASEURL}`,
          {
            message,
          }
        );
        // Handle the response
        console.log(response.data.message);
      } catch (error) {
        // Handle errors
        console.error(error);
      }
    }
  };

  useEffect(() => {
    const greetMessages = ['Hello!', 'Hi there!', 'Welcome!', 'Greetings!'];
    const helpMessage = ['help', 'kill', 'teach', 'assist'];
    const funnyJokes = [
      "Why don't scientists trust atoms? Because they make up everything!",
      "Why don't skeletons fight each other? They don't have the guts!",
      'Why did the scarecrow win an award? Because he was outstanding in his field!',
      'Why did the bicycle fall over? Because it was two-tired!',
      "Why couldn't the leopard play hide and seek? Because he was always spotted!",
      'Why did the tomato turn red? Because it saw the salad dressing!',
      'Why did the golfer bring two pairs of pants? In case he got a hole in one!',
      'Why did the math book look sad? Because it had too many problems!',
      "Why don't some couples go to the gym? Because some relationships don't work out!",
    ];

    const randomGreet =
      greetMessages[Math.floor(Math.random() * greetMessages.length)];
    const randomHelp =
      helpMessage[Math.floor(Math.random() * helpMessage.length)];
    const randomJoke =
      funnyJokes[Math.floor(Math.random() * funnyJokes.length)];

    if (chat === '') {
      setTimeout(() => {
        const botMessage = `${randomGreet} I'm the bot. How can I ${randomHelp} you?`;

        if (Math.random() < 0.5) {
          handleSendMessage('bot', botMessage);
        } else {
          handleSendMessage('bot', `Here's a joke for you: ${randomJoke}`);
        }
      }, 1000);
    }
  }, [chat]);

  const handleActionMessage = (
    messageId: string,
    action: 'delete' | 'edit',
    editedMessage?: string
  ) => {
    if (action === 'delete') {
      dispatch(deleteMessage(messageId));
    }
    if (action === 'edit') {
    }
  };

  return (
    <div
      className={`frame ${theme} flex text-black dark:bg-black justify-between flex-col w-full p-6`}
    >
      <div>
        <div className='flex justify-center mt-4'>
          <button
            className='toggleChatInput'
            onClick={() => setShowPrompt(!showPrompt)}
          >
            {showPrompt ? 'Hide Prompts' : 'Show Prompts'}
          </button>
        </div>
        <div
          className={`w-full flex flex-col items-center ${
            theme === 'dark' ? 'bg-[#282828]' : 'bg-[white]'
          } rounded-[6px] p-[8px]`}
        >
          {showPrompt && (
            <div className='flex justify-center mt-4 w-[50%] items-center border-[1px] border-[#5299cc] rounded-md h-9 '>
              <p className='text-[12px] cursor-pointer'>
                {prompts[Math.floor(Math.random() * prompts.length)]}
              </p>
            </div>
          )}

          <ChatMessages handleActionMessage={handleActionMessage} />
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
                  handleSendMessage('user', chat);
                }
              }}
            />
            <div
              className='absolute right-[10px]'
              onClick={() => handleSendMessage('user', chat)}
            >
              <AiOutlineSend
                size={20}
                className={`${theme === 'dark' ? 'text-white' : 'text-black'}`}
              />
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
  const { saveChatMessage } = useSessions();
  const { messages, clearChatMessages } = useChat();

  useEffect(() => {
    if (sessionId && messages) {
      saveChatMessage(sessionId, messages);
    }
  }, [messages, sessionId]);

  const messagesList = Object.values(messages).map((message: any) => ({
    id: message.id,
    role: message.role,
    message: message.message,
  }));
  return (
    <div className='chat-messages overflow-y-scroll max-h-[calc(100vh-200px)] w-full'>
      {messages ? (
        messagesList.map((message: MessageType) => (
          <div
            key={message.id}
            className={`message p-[8px] justify-between mt-[12px] rounded-[6px] ${
              message.role
            } ${
              theme === 'dark' ? 'bg-[#2E2E2E]' : 'bg-[#dee1ea]'
            }  gap-2 flex ${message.role === 'user' ? '#f0f4f8' : '#ffffff'}`}
            style={{
              boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
              animation: 'fadeInUp 0.5s ease-in-out',
            }}
          >
            <div className={`${message.role}-message gap-3 flex items-center`}>
              {message.role === 'user' ? (
                <FaUserAstronaut size={24} />
              ) : (
                <CgBot size={24} />
              )}
              <div className='message-text'>{message.message}</div>
              <div className='message-actions'></div>
            </div>
            <MdDeleteForever
              onClick={() => handleActionMessage(message.id, 'delete')}
              size={20}
            />
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

        .flex.items-center > *:not(:last-child) {
          margin-right: 8px;
        }

        .message-actions {
          margin-left: auto;
        }
      `}</style>
    </div>
  );
};
