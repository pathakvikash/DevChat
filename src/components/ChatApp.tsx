'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import ChatArea from './ChatArea';
import SidebarToggle from './svgComp/SidebarToggle';
import Sidebar from './Sidebar';
import NewChatSvg from './svgComp/NewChatSvg';
import {
  selectSessions,
  selectCurrentSessionId,
  createSession,
  deleteSession,
  sendMessage,
  setCurrentSessionId,
} from '../store/slice/chatSlice';
import { fetchTags, sendPromptRequest } from '../utils/api';
import { updateLastMessage } from '../store/slice/chatSlice';

const ChatApp: React.FC = () => {
  const sessions = useSelector(selectSessions);
  const currentSessionId = useSelector(selectCurrentSessionId);
  const dispatch = useDispatch();
  const [newMessage, setNewMessage] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [selectedTag, setSelectedTag] = useState<string>('');
  const chatAreaRef = useRef<{ resetState: () => void }>(null);

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  const handleCreateSession = () => {
    dispatch(createSession());
  };

  const handleDeleteSession = (sessionId: number) => {
    dispatch(deleteSession(sessionId));
  };

  const handleSendMessage = async () => {
    if (newMessage.trim() === '')
      return { controller: null, promise: Promise.resolve() };

    dispatch(
      sendMessage({
        sessionId: currentSessionId!,
        text: newMessage,
        role: 'user',
      })
    );
    setNewMessage('');

    const controller = new AbortController();
    const promise = processServerResponse(controller.signal);

    return { controller, promise };
  };

  const processServerResponse = async (signal: AbortSignal): Promise<void> => {
    try {
      const response = await sendPromptRequest({
        model: selectedTag || 'qwen2:1.5b',
        prompt: newMessage,
        system: 'You are a helpful assistant.',
        context: [],
        signal,
      });

      dispatch(
        sendMessage({ sessionId: currentSessionId!, text: '', role: 'server' })
      );

      await streamResponse(response.body?.getReader(), signal);
    } catch (error: unknown) {
      handleError(error as Error);
    }
  };

  const streamResponse = async (
    reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
    signal: AbortSignal
  ) => {
    let serverResponse = '';

    while (!signal.aborted) {
      const { value, done } = (await reader?.read()) ?? {};
      if (done) break;

      serverResponse = processChunk(
        new TextDecoder().decode(value),
        serverResponse
      );
    }
  };

  const processChunk = (chunk: string, serverResponse: string): string => {
    const lines = chunk.split('\n').filter((line) => line.trim() !== '');

    for (const line of lines) {
      try {
        const { response, done } = JSON.parse(line);
        if (response) {
          serverResponse += response;
          updateServerResponse(serverResponse, false);
        }
        if (done) {
          updateServerResponse(serverResponse, true);
          return serverResponse;
        }
      } catch (error) {
        console.error('Error processing response:', error);
      }
    }

    return serverResponse;
  };

  const updateServerResponse = (text: string, isComplete: boolean) => {
    dispatch(
      updateLastMessage({ sessionId: currentSessionId!, text, isComplete })
    );
  };

  const handleError = (error: Error) => {
    if (error.name === 'AbortError') {
      console.log('Fetch aborted');
    } else {
      console.error('Error sending message:', error);
    }
  };

  const handleStopResponse = async (
    controller: AbortController,
    promise: Promise<void>
  ) => {
    if (controller && typeof controller.abort === 'function') {
      controller.abort();
      await promise;
      dispatch(
        updateLastMessage({
          sessionId: currentSessionId!,
          isComplete: true,
        })
      );
      // Reset the state in ChatArea
      if (chatAreaRef.current) {
        chatAreaRef.current.resetState();
      }
    }
  };

  const handleSelectSession = (sessionId: number) => {
    dispatch(setCurrentSessionId(sessionId));
  };

  const fetchAvailableTags = async () => {
    try {
      const fetchedTags = await fetchTags();
      setTags(fetchedTags);
    } catch (error) {
      console.error('Error fetching tags:', error);
    }
  };

  useEffect(() => {
    fetchAvailableTags();
  }, []);

  useEffect(() => {
    if (chatAreaRef.current) {
      chatAreaRef.current.resetState();
    }
  }, [currentSessionId]);

  return (
    <div className='flex md:flex-row min-w-full min-h-screen'>
      <div className='flex fixed z-10 bg-gray-800 text-white justify-between gap-4 w-full p-4'>
        <div className='flex gap-4'>
          <button className='' onClick={toggleSidebar}>
            <SidebarToggle />
          </button>
          <div className='text-lg hidden md:block font-bold'>DEV CHAT</div>
        </div>

        <button
          onClick={handleCreateSession}
          className='text-white lg:block flex justify-end hover:scale-150 md:hidden'
        >
          <NewChatSvg />
        </button>
      </div>
      {sidebarOpen && (
        <Sidebar
          sessions={sessions}
          currentSessionId={currentSessionId}
          handleSelectSession={handleSelectSession}
          handleDeleteSession={handleDeleteSession}
          sidebarOpen={sidebarOpen}
        />
      )}
      <ChatArea
        ref={chatAreaRef}
        currentSessionId={currentSessionId}
        sessions={sessions}
        newMessage={newMessage}
        setNewMessage={setNewMessage}
        handleSendMessage={handleSendMessage}
        handleStopResponse={handleStopResponse}
        tags={tags}
        setSelectedTag={setSelectedTag}
      />
    </div>
  );
};

export default ChatApp;
