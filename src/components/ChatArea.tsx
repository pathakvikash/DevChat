import { Session } from '../store/slice/chatSlice';
import React, { useRef, useState, useEffect } from 'react';
import ModelSelect from './ModelSelect';
import TextEffect from './TextEffect';
import { Edit, LoaderPinwheel } from 'lucide-react';
import CopyButton from './ui/CopyButton';
import { useMessageHandling } from '../hooks/useMessageHandling';
import { useDispatch } from 'react-redux';
import { editMessage } from '../store/slice/chatSlice';

interface ChatAreaProps {
  currentSessionId: number | null;
  sessions: Session[];
  newMessage: string;
  setNewMessage: React.Dispatch<React.SetStateAction<string>>;
  handleSendMessage: (
    messageText?: string,
    isRegenerate?: boolean,
    regenerateMessageId?: number
  ) => Promise<{
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
    const [tokenCount, setTokenCount] = useState(0);
    const [wordCount, setWordCount] = useState(0);
    const [editingMessageId, setEditingMessageId] = useState<number | null>(
      null
    );
    const editedMessageRef = useRef<HTMLDivElement>(null);
    const { handleEditMessage }: any = useMessageHandling(currentSessionId);
    const dispatch = useDispatch();

    const resetState = () => {
      setActiveController(null);
      setActivePromise(null);
      setIsGenerating(false);
      setEditingMessageId(null);
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

    const handleClientEditMessage = (messageId: number) => {
      setEditingMessageId(messageId);
    };

    const handleRegenerateResponse = async (messageId: number) => {
      if (currentSessionId) {
        const session = sessions[currentSessionId - 1];
        const messageIndex = session.messages.findIndex(
          (m) => m.id === messageId
        );
        if (messageIndex > 0) {
          const previousUserMessage = session.messages[messageIndex - 1];
          if (previousUserMessage && previousUserMessage.sender === 'user') {
            await handleSendMessage(previousUserMessage.text, true, messageId);
          }
        }
      }
    };

    const handleSaveEdit = async (messageId: number, newText: string) => {
      if (currentSessionId) {
        dispatch(
          editMessage({
            sessionId: currentSessionId,
            messageId,
            text: newText,
          })
        );
        const session = sessions[currentSessionId - 1];
        const messageIndex = session.messages.findIndex(
          (m) => m.id === messageId
        );
        if (messageIndex >= 0 && messageIndex < session.messages.length - 1) {
          const nextMessage = session.messages[messageIndex + 1];
          if (nextMessage.sender === 'server') {
            await handleSendMessage(newText, true, nextMessage.id);
          }
        }
      }
      setEditingMessageId(null);
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

    const countWords = (text: string): number => {
      const words = text
        .trim()
        .split(/\s+/g)
        .filter((word) => word.length > 0);
      return words.length;
    };

    return (
      <div className='bg-gray-900 text-white w-full p-6 flex flex-col justify-between h-full'>
        <div className='text-lg font-bold mb-4 hidden md:block'>
          Chat Area {currentSessionId && `- Session ${currentSessionId}`}
        </div>
        <div className='flex flex-col overflow-y-auto sm:mt-12 md:mt-6 mt-16 flex-grow'>
          {currentSessionId &&
            sessions[currentSessionId - 1]?.messages.map((message) => (
              <div
                key={message.id}
                className={`p-2 mb-2 rounded ${
                  message.sender === 'user'
                    ? 'self-end ml-12 bg-blue-600'
                    : 'self-start mr-12 bg-gray-700'
                }`}
              >
                <div className='text-sm'>
                  <strong>{message.sender === 'user' ? 'You' : 'AI'}: </strong>
                  {editingMessageId === message.id ? (
                    <div
                      ref={editedMessageRef}
                      className='text-white'
                      contentEditable='true'
                      suppressContentEditableWarning={true}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSaveEdit(
                            message.id,
                            editedMessageRef.current?.innerHTML || ''
                          );
                        }
                      }}
                      onBlur={() =>
                        handleSaveEdit(
                          message.id,
                          editedMessageRef.current?.innerHTML || ''
                        )
                      }
                      dangerouslySetInnerHTML={{ __html: message.text }}
                    />
                  ) : (
                    <>
                      {message.sender === 'server' ? (
                        <div className='flex flex-col'>
                          <TextEffect
                            text={message.text}
                            isComplete={message.isComplete}
                            effect='streaming'
                            onRegenerate={() =>
                              handleRegenerateResponse(message.id)
                            }
                          />
                        </div>
                      ) : (
                        <span className=''>
                          {message.text.split('<br>').map((line, index) => (
                            <React.Fragment key={index}>
                              {line}
                              {index <
                                message.text.split('<br>').length - 1 && <br />}
                            </React.Fragment>
                          ))}
                          <div className='flex mt-2 gap-2 justify-end items-center'>
                            <CopyButton content={message.text} />
                            <Edit
                              className='hover:scale-110 hover:bg-blue-500 rounded-full p-1'
                              onClick={() =>
                                handleClientEditMessage(message.id)
                              }
                            />
                          </div>
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          <div ref={messagesEndRef} />
        </div>
        <div className='mt-6 w-full'>
          {tags.length > 0 && (
            <ModelSelect setSelectedTag={setSelectedTag} tags={tags} />
          )}
          {currentSessionId && (
            <div className='flex flex-col sm:flex-row mt-4 gap-2 relative'>
              <span className='absolute top-[-1.75rem] right-2 text-sm text-gray-400'>
                {tokenCount} tokens
              </span>
              <span>
                <span className='absolute top-[-1.75rem] left-2 text-sm text-gray-400'>
                  {wordCount} words
                </span>
              </span>
              <input
                type='text'
                id='user-message-input'
                className='flex-grow bg-gray-800 text-white p-2 rounded-lg sm:rounded-r-none'
                placeholder='Type a message...'
                value={newMessage}
                onChange={(e) => {
                  const message = e.target.value;
                  setNewMessage(message);

                  const wordCount = countWords(message);
                  setWordCount(wordCount);

                  const tokenCount = e.target.value.split(' ').length;
                  setTokenCount(tokenCount);
                }}
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