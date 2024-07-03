import { Session } from '../store/slice/chatSlice';
import DeleteSvg from './svgComp/DeleteSvg';
interface SidebarProps {
  sessions: Session[];
  currentSessionId: number | null;
  handleSelectSession: (sessionId: number) => void;
  handleDeleteSession: (sessionId: number) => void;
  sidebarOpen: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  currentSessionId,
  handleSelectSession,
  handleDeleteSession,
  sidebarOpen,
}) => {
  return (
    <div
      className={`bg-gray-800 sm:fixed md:relative fixed sm:w-1/3 w-[250px] h-screen text-white md:w-1/5 p-4
      `}
    >
      <div className='p-4'>
        <div className='flex mt-[20px] items-center justify-center gap-3 py-6'>
          <p className='text-[12px]'>RECENT CHATS</p>
          <hr className={`w-20 border border-white`} />
        </div>
        <div className={`flex flex-col ${sidebarOpen ? '' : 'hidden md:flex'}`}>
          {sessions.map((session, index) => (
            <div className='flex items-center' key={index}>
              <button
                key={session.id}
                className={`text-white text-sm p-2 w-10/12 rounded justify-center items-center hover:bg-gray-700 ${
                  session.id === currentSessionId ? 'bg-gray-700' : ''
                }`}
                onClick={() => handleSelectSession(session.id)}
              >
                {session.name}
              </button>
              {currentSessionId && (
                <button
                  className='text-white text-sm p-2 rounded hover:bg-gray-700'
                  onClick={() => handleDeleteSession(currentSessionId)}
                >
                  <DeleteSvg />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
