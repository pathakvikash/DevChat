import { Session } from '../store/slice/chatSlice';
import { useRef } from 'react';
import ModelSelect from './ModelSelect';

interface ChatAreaProps {
  currentSessionId: number | null;
  sessions: Session[];
  newMessage: string;
  setNewMessage: React.Dispatch<React.SetStateAction<string>>;
  handleSendMessage: () => void;
}

const ChatArea: React.FC<ChatAreaProps> = ({
  currentSessionId,
  sessions,
  newMessage,
  setNewMessage,
  handleSendMessage,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  return (
    <div className='bg-gray-900 text-white w-full p-6 flex flex-col justify-between h-full'>
      <div className='text-lg font-bold mb-4 hidden md:block'>
        Chat Area {currentSessionId && `- Session ${currentSessionId}`}
      </div>
      <div className='flex flex-col overflow-y-auto flex-grow'>
        {currentSessionId &&
          sessions[currentSessionId - 1]?.messages.map((message) => (
            <div
              key={message.id}
              className={`bg-gray-800 p-2 mb-2 rounded ${
                message.sender === 'user' ? 'self-end' : 'self-start'
              }`}
            >
              <div className='text-sm'>{`${message.sender}: ${message.text}`}</div>
            </div>
          ))}
        <div ref={messagesEndRef} />
      </div>
      {/* Message input */}
      <div className='mt-6'>
        <ModelSelect />
        {currentSessionId && (
          <div className='flex mt-4'>
            <input
              type='text'
              className='flex-1 bg-gray-800 text-white p-2 rounded-l'
              placeholder='Type a message...'
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSendMessage();
                }
              }}
            />
            <button
              className='bg-blue-500 hover:scale-150 text-white p-2 rounded-r'
              onClick={handleSendMessage}
            >
              ⦿
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatArea;
