import React, { useState, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { setTheme } from '../../store/themeSlice';

export function useTheme() {
  const theme = useSelector((state) => state.theme);

  const dispatch = useDispatch();
  const toggleTheme = useCallback(() => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    dispatch(setTheme(newTheme));
  }, [theme]);

  // return theme and toggleTheme as an object
  return { theme, toggleTheme };
}

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      className='fixed top-4 right-4 bg-gray-200 dark:bg-gray-800 px-4 py-2 rounded-lg'
      onClick={toggleTheme}
    >
      {theme === 'light' ? '🌙' : '☀️'}
    </button>
  );
}
