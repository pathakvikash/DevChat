'use client';
import React, { useState } from 'react';
import ChatArea from './ChatArea';
import { useSelector, useDispatch } from 'react-redux';
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

const ChatApp: React.FC = () => {
  const sessions = useSelector(selectSessions);
  const currentSessionId = useSelector(selectCurrentSessionId);
  const dispatch = useDispatch();
  const [newMessage, setNewMessage] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
    if (newMessage.trim() === '') return;

    dispatch(
      sendMessage({
        sessionId: currentSessionId!,
        text: newMessage,
        role: 'user',
      })
    );
    setNewMessage('');

    try {
      const response = await fetch('https://proxy.tune.app/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: process.env.NEXT_PRIVATE_TUNE || '',
        },
        body: JSON.stringify({
          temperature: 0.8,
          messages: [
            {
              role: 'system',
              content: 'You are a helpful assistant.',
            },
            {
              role: 'user',
              content: newMessage,
            },
          ],
          model: 'kaushikaakash04/tune-blob',
          stream: false,
          frequency_penalty: 0,
          max_tokens: 90,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        dispatch(
          sendMessage({
            sessionId: currentSessionId!,
            text: data.choices[0].message.content,
            role: data.choices[0].message.role,
          })
        );
      } else {
        console.error('Error sending message:', data);
      }
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  const handleSelectSession = (sessionId: number) => {
    dispatch(setCurrentSessionId(sessionId));
  };

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
        currentSessionId={currentSessionId}
        sessions={sessions}
        newMessage={newMessage}
        setNewMessage={setNewMessage}
        handleSendMessage={handleSendMessage}
      />
    </div>
  );
};

export default ChatApp;
