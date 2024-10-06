'use client';

import React, { useState, useRef } from 'react';
import ChatArea from './ChatArea';
import SidebarToggle from './svgComp/SidebarToggle';
import Sidebar from './Sidebar';
import NewChatSvg from './svgComp/NewChatSvg';
import Workspace from '../app/workspace/page';
import { useSessionManagement } from '../hooks/useSessionManagement';
import { useMessageHandling } from '../hooks/useMessageHandling';
import { useTagManagement } from '../hooks/useTagManagement';
import { useWorkspaceVisibility } from '../hooks/useWorkspaceVisibility';
const ChatApp: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const chatAreaRef = useRef<{ resetState: () => void }>(null);

  const {
    sessions,
    currentSessionId,
    handleCreateSession,
    handleDeleteSession,
    handleSelectSession,
  } = useSessionManagement();
  const { newMessage, setNewMessage, handleSendMessage, setSelectedModel } =
    useMessageHandling(currentSessionId);
  const { tags, selectedTag, setSelectedTag } = useTagManagement();
  const { isWorkspaceVisible, handlers } = useWorkspaceVisibility();

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  const handleStopResponse = async (
    controller: AbortController,
    promise: Promise<void>
  ) => {
    if (controller && typeof controller.abort === 'function') {
      controller.abort();
      await promise;
      if (chatAreaRef.current) {
        chatAreaRef.current.resetState();
      }
    }
  };
  const handleChatCreateSession = () => {
    handleCreateSession();
    setTimeout(() => {
      const userInput = document.getElementById(
        'user-message-input'
      ) as HTMLInputElement;
      userInput.value = '';
      userInput.focus();
    }, 100);
  };

  return (
    <div {...handlers} className='flex md:flex-row min-w-full min-h-screen'>
      {!isWorkspaceVisible && (
        <>
          <div className='flex fixed z-10 bg-gray-800 text-white justify-between gap-4 w-full p-4'>
            <div className='flex gap-4'>
              <button
                className=''
                onClick={toggleSidebar}
                aria-label='Toggle sidebar'
              >
                <SidebarToggle />
              </button>
              <div className='text-lg hidden md:block font-bold'>DEV CHAT</div>
            </div>

            <button
              onClick={handleChatCreateSession}
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
            setSelectedTag={setSelectedModel}
          />
        </>
      )}
      {isWorkspaceVisible && <Workspace />}
    </div>
  );
};

export default ChatApp;
