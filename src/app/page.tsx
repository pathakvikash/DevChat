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
import { sessionId } from '../utils/localstorage';

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
  useEffect(() => {
    if (sessionId) {
      dispatch(setCurrentSession(sessionId));
    } else {
      const newId = v4();
      dispatch(addSession({ id: newId, messages: [], name: 'New Chat' }));
      window.localStorage.setItem('sessionId', newId);
    }
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
