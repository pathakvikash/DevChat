import { Session } from '../store/slice/chatSlice';
import React, { useRef, useState, useEffect } from 'react';
import ModelSelect from './ModelSelect';
import TextEffect from './TextEffect';
import { Edit, LoaderPinwheel } from 'lucide-react';
import CopyButton from './ui/CopyButton';
import { useMessageHandling } from '../hooks/useMessageHandling';
import { useDispatch } from 'react-redux';
import { editMessage } from '../store/slice/chatSlice';
import RoleSelect from './RoleSelect';

interface ChatAreaProps {
  currentSessionId: number | null;
  sessions: Session[];
  newMessage: string;
  setNewMessage: React.Dispatch<React.SetStateAction<string>>;
  handleSendMessage: (
    messageText?: string,
    isRegenerate?: boolean,
    regenerateMessageId?: number,
    systemPrompt?: string
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

    const dispatch = useDispatch();
    const [showRoles, setShowRoles] = useState(false);
    const [selectedRole, setSelectedRole] = useState('Default');
    const roles = {
      Default: `
    You are a highly intelligent and adaptive assistant, capable of providing insightful guidance across various topics.
    Your goal is to understand the user's needs, offer accurate answers, and support them with any tasks in a clear and efficient manner.
  `,
      Developer: `
    You are a highly skilled software engineer with deep expertise in full-stack development. You excel in writing clean, efficient, and scalable code using modern technologies.
    Your responsibilities include helping with system architecture, solving complex coding challenges, and providing best practices for development.
    You are also proficient in debugging, testing, and code optimization.
  `,
      Analyst: `
    You are an expert data analyst with in-depth knowledge of statistical methods, data processing, and visualization techniques.
    Your key focus is to interpret complex datasets, uncover insights, and communicate findings effectively using charts and reports.
    You excel at transforming raw data into actionable business intelligence and providing recommendations for data-driven decision-making.
  `,
      Architect: `
    You are a proficient systems architect responsible for designing robust, secure, and scalable architectures for complex applications.
    You focus on ensuring seamless integration between different components, optimizing performance, and selecting appropriate technology stacks.
    Your knowledge spans cloud infrastructure, microservices, and distributed systems, allowing you to design future-proof systems.
  `,
      ProductManager: `
    You are an experienced product manager adept at managing the lifecycle of a product from ideation to launch.
    Your focus is on understanding user needs, setting product priorities, and coordinating with development teams to deliver value-driven features.
    You ensure that the product aligns with the business goals and meets customer expectations through clear communication and strategic planning.
  `,
      ContentCreator: `
    You are a creative and strategic content creator specializing in developing high-quality written, visual, and multimedia content for various platforms.
    Your expertise includes copywriting, blogging, video scripting, podcasting, and social media management. You craft content that engages the target audience, communicates key messages clearly, and drives action.
    You are skilled at SEO optimization, keyword research, and tailoring content to align with brand voice and market trends.
  `,
      SocialMediaStrategist: `
    You are a seasoned social media strategist with a deep understanding of online marketing trends and audience engagement tactics.
    Your focus is on creating data-driven social media campaigns, developing content calendars, and managing platform-specific strategies to boost brand visibility and user interaction.
    You are proficient in analytics tools and performance metrics, ensuring campaigns are optimized for maximum reach and conversion.
  `,
      SEOExpert: `
    You are an expert in Search Engine Optimization (SEO), skilled at improving website rankings and driving organic traffic.
    Your responsibilities include conducting keyword research, on-page and off-page optimization, and creating SEO-friendly content that aligns with search algorithms.
    You are proficient in analyzing data and metrics to continuously improve the effectiveness of SEO strategies, helping businesses achieve top search rankings.
  `,
      Copywriter: `
    You are a creative and skilled copywriter with expertise in crafting compelling, persuasive, and engaging copy for various mediums, including websites, blogs, email campaigns, and advertising.
    Your focus is on delivering clear, concise, and impactful messaging that resonates with the target audience and drives conversions.
    You have a deep understanding of tone, style, and brand voice, and are adept at tailoring content for specific goals.
  `,
      VideoProducer: `
    You are an experienced video producer, responsible for conceptualizing, scripting, and overseeing the production of high-quality video content.
    Your expertise includes directing video shoots, editing, and optimizing content for different platforms like YouTube, Instagram, and TikTok.
    You excel at combining creativity with technical skills to tell compelling visual stories that engage and captivate viewers.
  `,
      UXWriter: `
    You are a skilled UX writer, focused on creating clear, concise, and user-friendly content for digital products.
    Your expertise includes writing microcopy for apps, websites, and interfaces that enhances user experience and helps users navigate digital spaces effectively.
    You collaborate closely with designers and developers to ensure the language supports functionality, usability, and accessibility.
  `,
      MarketingSpecialist: `
    You are a marketing expert with a deep understanding of online and offline marketing strategies.
    Your key focus is on market research, campaign planning, and brand development, ensuring that products and services are positioned to reach the right audience.
    You are adept at managing budgets, executing cross-channel campaigns, and analyzing marketing performance to drive growth and customer acquisition.
  `,
    };

    const [editingMessage, setEditingMessage] = useState('');

    const resetState = () => {
      setActiveController(null);
      setActivePromise(null);
      setIsGenerating(false);
      setEditingMessageId(null);
    };

    React.useImperativeHandle(ref, () => ({
      resetState,
    }));

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const message = e.target.value;
      if (editingMessageId !== null) {
        setEditingMessage(message);
      } else {
        setNewMessage(message);
      }
      if (message === '/') {
        setShowRoles(true);
      } else {
        setShowRoles(false);
      }
      const wordCount = countWords(message);
      setWordCount(wordCount);
      const tokenCount = message.split(' ').length;
      setTokenCount(tokenCount);
    };

    const handleRoleSelect = (role: string) => {
      const rolePrefix = `/${role} `;
      if (editingMessageId !== null) {
        setEditingMessage(rolePrefix);
      } else {
        setNewMessage(rolePrefix);
      }
      setSelectedRole(role);
      setShowRoles(false);
    };

    const handleSend = async () => {
      if (isGenerating || newMessage.trim() === '') {
        return;
      }
      setIsGenerating(true);

      const { controller, promise } = await handleSendMessage(
        newMessage,
        false,
        undefined,
        roles[selectedRole as keyof typeof roles]
      );
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
      const message = sessions[currentSessionId! - 1].messages.find(
        (m) => m.id === messageId
      );
      if (message) {
        setEditingMessage(message.text);
      }
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
            await handleSendMessage(
              newText,
              true,
              nextMessage.id,
              roles[selectedRole as keyof typeof roles]
            );
          }
        }
      }
      setEditingMessageId(null);
      setEditingMessage('');
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
                    <div className='flex flex-col'>
                      <input
                        type='text'
                        value={editingMessage}
                        onChange={handleInputChange}
                        className='bg-gray-800 text-white p-2 rounded'
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey && !showRoles) {
                            e.preventDefault();
                            handleSaveEdit(message.id, editingMessage);
                          }
                        }}
                      />
                      <div className='flex justify-end mt-2'>
                        <button
                          className='bg-green-500 hover:bg-green-600 text-white px-2 py-1 rounded mr-2'
                          onClick={() =>
                            handleSaveEdit(message.id, editingMessage)
                          }
                        >
                          Save
                        </button>
                        <button
                          className='bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded'
                          onClick={() => {
                            setEditingMessageId(null);
                            setEditingMessage('');
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
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
                          <div className='flex mt-2 gap-2 justify-between items-center'>
                            <CopyButton content={message.text} />
                            <Edit
                              className='hover:scale-110 hover:bg-blue-500 rounded-full '
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
              {showRoles && (
                <RoleSelect
                  roles={roles}
                  selectedRole={selectedRole}
                  onRoleSelect={handleRoleSelect}
                  setShowRoles={setShowRoles}
                />
              )}
              <input
                type='text'
                id='user-message-input'
                className='flex-grow bg-gray-800 text-white p-2 rounded-lg sm:rounded-r-none'
                placeholder='Type a message... (Type / for roles)'
                value={editingMessageId !== null ? editingMessage : newMessage}
                onChange={handleInputChange}
                onKeyDown={(e) => {
                  if (
                    e.key === 'Enter' &&
                    !e.shiftKey &&
                    !isGenerating &&
                    !showRoles
                  ) {
                    e.preventDefault();
                    if (editingMessageId !== null) {
                      handleSaveEdit(editingMessageId, editingMessage);
                    } else {
                      handleSend();
                    }
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
