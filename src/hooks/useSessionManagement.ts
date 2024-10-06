import { useSelector, useDispatch } from 'react-redux';
import {
  selectSessions,
  selectCurrentSessionId,
  createSession,
  deleteSession,
  setSessionName,
  setCurrentSessionId,
} from '../store/slice/chatSlice';

export const useSessionManagement = () => {
  const dispatch = useDispatch();
  const sessions = useSelector(selectSessions);
  const currentSessionId = useSelector(selectCurrentSessionId);

  const handleCreateSession = () => {
    dispatch(createSession());
  };
  const updateSessionName = (sessionName: string) => {
    if (currentSessionId) {
      dispatch(
        setSessionName({
          sessionId: currentSessionId,
          name: sessionName,
        })
      );
    }
  };

  const handleDeleteSession = (sessionId: number) => {
    dispatch(deleteSession(sessionId));
  };

  const handleSelectSession = (sessionId: number) => {
    dispatch(setCurrentSessionId(sessionId));
  };

  return {
    sessions,
    currentSessionId,
    handleCreateSession,
    handleDeleteSession,
    handleSelectSession,
    updateSessionName,
  };
};
