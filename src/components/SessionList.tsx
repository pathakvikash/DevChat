import React, { useState } from 'react';
import { FaBlog, FaEdit, FaTrashAlt } from 'react-icons/fa';
import { useDispatch, useSelector } from 'react-redux';
import { editSessionName, deleteSession } from '../../store/sessionsSlice';

interface Session {
  id: number;
  name: string;
}

const SessionList: React.FC = () => {
  const [selectedSession, setSelectedSession] = useState<number | null>(null);
  const theme = useSelector((state: any) => state.theme);

  const dispatch = useDispatch();
  const allSessions = useSelector(
    (state: any) => state.root.sessions?.sessions
  );
  const mappedSessions = allSessions.map((session: any) => {
    return {
      id: session.sessions.id,
      name: session.sessions.name,
    };
  });

  const handleEditSessionName = (sessionId: number, newName: string) => {
    dispatch(editSessionName({ sessionId, newName }));
    setSelectedSession(null);
  };

  const handleDeleteSession = (sessionId: number) => {
    dispatch(deleteSession(sessionId));
    setSelectedSession(null);
  };

  return (
    <div
      className={`flex flex-col gap-2 rounded-lg
      }`}
    >
      <div className={`flex flex-col gap-2 `}>
        {mappedSessions.map((session: Session) => (
          <div
            key={session.id}
            className={`session-summary p-3 rounded-lg shadow-md cursor-pointer ${
              selectedSession === session.id
                ? theme == 'light'
                  ? 'bg-blue-100'
                  : 'bg-blue-900'
                : theme === 'light'
                ? 'hover:bg-gray-100'
                : 'hover:bg-gray-900'
            } ${theme === 'dark' ? 'bg-[#1D1D1D]' : 'bg-[#dee1ea]'} `}
            onClick={() => setSelectedSession(session.id)}
          >
            <div className='flex items-center justify-between'>
              <div className='flex items-center'>
                <FaBlog className='mr-2' />
                <input
                  type='text'
                  placeholder='Session name'
                  value={session.name}
                  onChange={(e) =>
                    handleEditSessionName(session.id, e.target.value)
                  }
                  onBlur={() => setSelectedSession(null)}
                  className='bg-transparent border-b border-gray-300 focus:outline-none focus:border-blue-500 transition-colors'
                />
              </div>
              {selectedSession === session.id && (
                <div className='flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity'>
                  <FaEdit
                    onClick={() =>
                      handleEditSessionName(session.id, session.name)
                    }
                    className='cursor-pointer text-gray-500 hover:text-blue-500 transition-colors'
                  />
                </div>
              )}
              <FaTrashAlt
                onClick={() => handleDeleteSession(session.id)}
                className='cursor-pointer text-gray-500 hover:text-red-500 transition-colors'
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SessionList;
