import { Session } from '../../store/sessionsSlice';
import React, { useEffect, useState } from 'react';
import { FaTumblrSquare, FaBlog, FaUserCircle } from 'react-icons/fa';
import { FaTrashAlt, FaEdit } from 'react-icons/fa';
import Image from 'next/image';
import { v4 } from 'uuid';
import { useDispatch, useSelector } from 'react-redux';
import { useChat, useSessions } from '../../store/hooks/hook';

type SidebarProps = {
  darkmode: boolean;
  onToggleTheme: () => void;
};

const Sidebar: React.FC<SidebarProps> = ({ darkmode, onToggleTheme }) => {
  const dispatch = useDispatch();
  const sessionId = localStorage?.getItem('sessionId') as string;
  const { addChatSession, saveChatMessage, deleteChatSession, sessions } =
    useSessions();
  const messages = useSelector((state: any) => state.root.chat.messages);
  const sessionList = Object.values(sessions).map((session: any) => ({
    id: session.id,
    name: session.name,
  }));

  const newSession = () => {
    const newSessionId = v4();

    addChatSession({
      id: newSessionId,
      messages: [],
      name: 'New Chat',
    });

    localStorage.setItem('sessionId', newSessionId);
  };

  useEffect(() => {
    newSession();
    if (sessionId) {
      saveChatMessage(sessionId, messages);
    } else {
      localStorage.setItem('sessionId', v4());
    }
  }, []);

  const handleDeleteSession = (sessionId: string) => {
    deleteChatSession(sessionId);
  };
  return (
    <div
      className={`sidebar overflow-visible  justify-between p-[8px] w-[250px] flex flex-col ${
        darkmode
          ? 'bg-black text-white'
          : 'bg-white-dark border-1 shadow-md border-x-slate-700'
      }`}
    >
      <div className='flex  flex-col gap-[16px] sideContainer w-full'>
        <div className='flex items-center gap-3 '>
          <img
            src={`${
              darkmode
                ? 'https://chat.rc.nbox.ai/NimbleBox.svg'
                : 'https://chat.nbox.ai/NimbleBox-light.svg'
            }`}
            alt=''
          />
        </div>
        <div
          onClick={newSession}
          className='px-[12px] h-[32px] items-center border-[black] rounded-[6px] gap-[6px] border-1 flex bg-[#6025E1] text-white w-full cursor-pointer'
        >
          <div>+</div>
          <button>New Chat</button>
        </div>
        <div className='flex mt-[20px] items-center justify-center gap-3 '>
          <p className='text-[12px]'>RECENT CHATS</p>
          <hr
            className={`w-20
          ${darkmode ? 'border-white' : 'border-black'}
          `}
          />
        </div>
        <div className='flex flex-col gap-2 '>
          {sessionList?.map((session: any) => (
            <div
              className='p-3 rounded-lg bg-white dark:bg-purple-900 shadow-md cursor-pointer '
              key={session.id}
            >
              <div className='flex justify-between items-center'>
                <div className='flex-col'>
                  <p className=''>ID: {session.id.split('-')[0]}</p>
                </div>
                <div className='delete'>
                  <FaTrashAlt
                    onClick={() => handleDeleteSession(session.id)}
                    className='cursor-pointer text-gray-500 hover:text-red-500 transition-colors'
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        className={`flex flex-col p-[6px] my-6 gap-[6px] items-start
      ${darkmode ? 'bg-[#1D1D1D]' : ' text-black bg-[#F6F8FA]'}
       border-neutral-700 rounded-[6px] `}
      >
        <div
          onClick={onToggleTheme}
          className='flex cursor-pointer items-center p-1 justify-center gap-2'
        >
          <button className='themeToggle'>{darkmode ? '🌙' : '☀️'}</button>
          <p>Switch Theme</p>
        </div>
        <div className='flex items-center p-1 justify-center gap-2'>
          <button className='logout' onClick={onToggleTheme}>
            {darkmode ? <FaTumblrSquare /> : <FaUserCircle />}
          </button>
          <p>{darkmode ? 'Logout' : 'Login'}</p>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
