// Sidebar.tsx
import React, { useEffect, useState } from 'react';
import { FaTumblrSquare, FaBlog, FaUserCircle } from 'react-icons/fa';
import { FaTrashAlt, FaEdit } from 'react-icons/fa';
import Image from 'next/image';
import SessionList from './SessionList';
import { v4 } from 'uuid';
import { addSession, setCurrentSession } from '../../store/sessionsSlice';
import { useDispatch, useSelector } from 'react-redux';
import internal from 'stream';

type SidebarProps = {
  darkmode: boolean;
  onToggleTheme: () => void;
};

const Sidebar: React.FC<SidebarProps> = ({ darkmode, onToggleTheme }) => {
  const sessionId = localStorage.getItem('sessionId');
  const chatSessions = localStorage.getItem(`${sessionId}`);
  const dispatch = useDispatch();

  function newSession() {
    const newSessionId = v4();
    dispatch(
      addSession({
        sessions: {
          id: newSessionId?.valueOf(),
          messages: [],
          name: 'New Chat',
        },
      })
    );
    dispatch(setCurrentSession(sessionId));
    localStorage.setItem('sessionId', newSessionId);
  }
  useEffect(() => {}, [sessionId?.valueOf()]);

  const allSessions = useSelector(
    (state: any) => state.root.sessions?.sessions
  );
  const mappedSessions = allSessions.map((session: any) => {
    return {
      id: session.sessions.id,
      name: session.sessions.name,
    };
  });

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
        <SessionList />
        <div className='flex flex-col gap-2 '>
          {mappedSessions?.map((session: any) => (
            <div
              className='p-3 rounded-lg bg-white shadow-md cursor-pointer '
              key={session.id}
            >
              {session.name}
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
