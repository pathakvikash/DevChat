import { Session } from '../store/slice/chatSlice';
import React, { useRef, useState, useEffect } from 'react';
import ModelSelect from './ModelSelect';
import TextEffect from './TextEffect';

interface ChatAreaProps {
  currentSessionId: number | null;
  sessions: Session[];
  newMessage: string;
  setNewMessage: React.Dispatch<React.SetStateAction<string>>;
  handleSendMessage: () => Promise<{
    controller: AbortController | null;
    promise: Promise<void>;
  }>;
  handleStopResponse: (
    controller: AbortController,
    promise: Promise<void>
  ) => void;
  tags: string[];
  setSelectedTag: React.Dispatch<React.SetStateAction<string>>;
}

const ChatArea = React.forwardRef<{ resetState: () => void }, ChatAreaProps>(
  (
    {
      currentSessionId,
      sessions,
      newMessage,
      setNewMessage,
      handleSendMessage,
      handleStopResponse,
      tags,
      setSelectedTag,
    },
    ref
  ) => {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const [activeController, setActiveController] =
      useState<AbortController | null>(null);
    const [activePromise, setActivePromise] = useState<Promise<void> | null>(
      null
    );
    const [isGenerating, setIsGenerating] = useState(false);

    const resetState = () => {
      setActiveController(null);
      setActivePromise(null);
      setIsGenerating(false);
    };

    React.useImperativeHandle(ref, () => ({
      resetState,
    }));

    const handleSend = async () => {
      if (isGenerating || newMessage.trim() === '') {
        return;
      }
      setIsGenerating(true);
      const { controller, promise } = await handleSendMessage();
      setActiveController(controller);
      setActivePromise(promise);
      promise.then(() => {
        setIsGenerating(false);
        setActiveController(null);
        setActivePromise(null);
      });
    };

    const handleStop = async () => {
      if (activeController && activePromise) {
        await handleStopResponse(activeController, activePromise);
        resetState();
      }
    };

    useEffect(() => {
      if (currentSessionId && sessions[currentSessionId - 1]) {
        const lastMessage =
          sessions[currentSessionId - 1].messages[
            sessions[currentSessionId - 1].messages.length - 1
          ];
        if (
          lastMessage &&
          lastMessage.sender === 'server' &&
          lastMessage.isComplete
        ) {
          setActiveController(null);
          setIsGenerating(false);
        }
      }
    }, [currentSessionId, sessions]);
    return (
      <div className='bg-gray-900 text-white w-full p-6 flex flex-col justify-between h-full'>
        <div className='text-lg font-bold mb-4 hidden md:block'>
          Chat Area {currentSessionId && `- Session ${currentSessionId}`}
        </div>
        <div className='flex flex-col overflow-y-auto sm:mt-12 md:mt-6 mt-16 flex-grow'>
          {currentSessionId &&
            sessions[currentSessionId - 1]?.messages.map((message, index) => (
              <div
                key={message.id}
                className={`bg-gray-800 p-2 mb-2 rounded ${
                  message.sender === 'user' ? 'self-end' : 'self-start'
                }`}
              >
                <div className='text-sm'>
                  <strong>{message.sender}: </strong>
                  {message.sender === 'server' &&
                  index ===
                    sessions[currentSessionId - 1].messages.length - 1 ? (
                    <TextEffect
                      text={message.text}
                      isComplete={message.isComplete}
                      effect='streaming'
                    />
                  ) : (
                    message.text
                  )}
                </div>
              </div>
            ))}
          <div ref={messagesEndRef} />
        </div>
        <div className='mt-6 w-full'>
          <ModelSelect setSelectedTag={setSelectedTag} tags={tags} />
          {currentSessionId && (
            <div className='flex flex-col sm:flex-row mt-4 gap-2'>
              <input
                type='text'
                className='flex-grow bg-gray-800 text-white p-2 rounded-lg sm:rounded-r-none'
                placeholder='Type a message...'
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isGenerating) {
                    handleSend();
                  }
                }}
              />
              <div className='flex'>
                {isGenerating ? (
                  <button
                    className='w-full sm:w-auto bg-red-500 hover:bg-red-600 text-white p-2 rounded-lg sm:rounded-l-none'
                    onClick={handleStop}
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    className='w-full sm:w-auto bg-blue-500 hover:bg-blue-600 text-white p-2 rounded-lg sm:rounded-l-none'
                    onClick={handleSend}
                  >
                    Send
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
);

export default ChatArea;
