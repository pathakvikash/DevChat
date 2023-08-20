'use client';
import { useState } from 'react';
import { PiToggleRightFill } from 'react-icons/pi';
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

  return (
    <div className={`flex p-3 justify-between items-center flex-wrap`}>
      {show && (
        <div className='flex dark:bg-black fixed flex-col cursor-pointer  items-start p-4 right-0 transform -translate-x-[12%] -translate-y-[60%] min-w-[200px] max-w-md bg-white rounded-lg shadow-lg mt-[-8px]'>
          <p className=''>+ Add a Model</p>
          {models.map((model) => (
            <div
              key={model.id}
              className={`flex items-center justify-between w-full py-1 hover:bg-gray-100 cursor-pointer ${
                selectedModel === model.id ? 'bg-blue-200' : ''
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
      <div className='web flex items-center gap-1'>
        <p>Search Web</p>
        <PiToggleRightFill />
      </div>
      <div
        className={`modelSelection flex ${
          theme === 'dark' ? 'text-white bg-[#232323]' : 'bg-[#dee1ea]'
        }`}
        onClick={toggleModelDialog}
      >
        <p>
          Models:{' '}
          {selectedModel &&
            models.find((model) => model.id === selectedModel)?.name}
        </p>
      </div>
    </div>
  );
};

export default ModelSelect;
