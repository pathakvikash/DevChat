'use client';
import React, { useState, useEffect } from 'react';
import Sidebar from '../components/Sidebar';
import Chat from '../components/Chat';
import { setTheme } from '../../store/themeSlice';
import { useSelector, useDispatch } from 'react-redux';
import { ThemeToggle } from '@/components/components/ThemeToggle.jsx';
import { v4 } from 'uuid';
import { MessageType } from '../components/Chat';
import {
  setCurrentSession,
  addSession,
  clearCurrentSession,
} from '../../store/sessionsSlice';

export type SessionType = {
  id: string;
  messages: MessageType[];
};

const Home = () => {
  const theme = useSelector((state: any) => state.theme);
  const dispatch = useDispatch();
  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    dispatch(setTheme(newTheme));
  };

  const sessionId = localStorage.getItem('sessionId');
  const currentMsgs = useSelector((state: any) => state.root.chat.messages);

  function helper() {
    if (sessionId) {
      dispatch(
        addSession({
          sessions: {
            id: sessionId?.valueOf(),
            messages: currentMsgs || [],
            name: 'New Chat',
          },
        })
      );
      dispatch(setCurrentSession(sessionId));
    } else {
      const newSessionId = v4();
      localStorage.setItem('sessionId', newSessionId);
      if (newSessionId) {
        dispatch(
          addSession({
            sessions: {
              id: newSessionId?.valueOf(),
              messages: [],
              name: 'New Chat',
            },
          })
        );
        dispatch(setCurrentSession(newSessionId?.valueOf()));
      }
    }
  }
  useEffect(() => {
    helper();
  }, []);

  return (
    <div className={`${theme} flex h-[100vh] `}>
      <Sidebar darkmode={theme === 'dark'} onToggleTheme={toggleTheme} />{' '}
      <ThemeToggle />
      <Chat />
    </div>
  );
};

export default Home;
