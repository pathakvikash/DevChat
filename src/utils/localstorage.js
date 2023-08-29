const LOCAL_STORAGE_KEY = 'chatSessions';
export const sessionId =
  typeof window !== 'undefined'
    ? window.localStorage.getItem('sessionId')
    : null;

export const saveSessionsToLocalStorage = (sessions) => {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(sessions));
};

export const loadSessionsFromLocalStorage = () => {
  const sessionsJson = localStorage.getItem(LOCAL_STORAGE_KEY);
  return sessionsJson ? JSON.parse(sessionsJson) : [];
};
