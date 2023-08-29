'use client';
import { useState } from 'react';
interface Model {
  id: number;
  name: string;
}

interface Props {
  theme: 'dark' | 'light';
  models: Model[];
}
const ModelSelect: React.FC<Props> = ({ theme, models }) => {
  const [selectedModel, setSelectedModel] = useState<number | undefined>(
    models[0]?.id
  );

  const [show, setShow] = useState(false);
  const toggleModelDialog = () => {
    setShow(!show);
  };

  const [toggleOn, setToggleOn] = useState(false);

  const handleToggle = () => {
    setToggleOn(!toggleOn);
  };

  return (
    <div className={`flex p-3 justify-between items-center flex-wrap`}>
      {show && (
        <div className='flex dark:bg-black fixed flex-col cursor-pointer  items-start p-4 right-0 transform -translate-x-[12%] -translate-y-[60%] min-w-[200px] max-w-md bg-white rounded-lg shadow-lg mt-[-8px]'>
          <p className=''>+ Add a Model</p>
          {models.map((model) => (
            <div
              key={model.id}
              className={`flex p-3 rounded-md dark:hover:bg-slate-500 items-center justify-between w-full py-1 hover:bg-gray-100 cursor-pointer ${
                selectedModel === model.id ? 'bg-blue-500' : ''
              }`}
              onClick={() => setSelectedModel(model.id)}
            >
              <p>{model.name}</p>
              {selectedModel === model.id && (
                <span className='text-green-500'>&#10003;</span>
              )}
            </div>
          ))}
        </div>
      )}
      <div className='web flex items-center gap-2'>
        <p>Search Web</p>
        <button
          className={`w-6 h-4 flex items-center rounded-full ${
            toggleOn ? 'bg-blue-500' : 'bg-gray-200'
          }`}
          onClick={handleToggle}
        >
          <span
            className={`w-3 h-3 rounded-full bg-white shadow transform transition-transform ${
              toggleOn ? 'translate-x-3' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
      <div
        className={`modelSelection flex ${
          theme === 'dark' ? 'text-white bg-[#232323]' : 'bg-[#dee1ea]'
        } shadow-md rounded-lg p-1 hover:scale-105 transition-transform duration-300`}
        onClick={toggleModelDialog}
      >
        <p className='text flex gap-2'>
          Models:{' '}
          <div className='dark:bg-[#3f4a6b] rounded-md px-1 flex'>
            {selectedModel &&
              models.find((model) => model.id === selectedModel)?.name}
          </div>
        </p>
      </div>
    </div>
  );
};

export default ModelSelect;
