'use client';
import { useState } from 'react';
interface Model {
  id: number;
  name: string;
}

const models: Model[] = [
  { id: 1, name: 'Open AI' },
  { id: 2, name: 'LLama' },
  { id: 3, name: 'vicuna' },
];

const ModelSelect: React.FC = () => {
  const [selectedModel, setSelectedModel] = useState<number | undefined>(
    models[0]?.id
  );

  const [show, setShow] = useState(false);
  const toggleModelDialog = () => {
    setShow(!show);
    if (show) {
      setSelectedModel(undefined);
    }
  };

  return (
    <div className={`flex p-3 justify-between items-center flex-wrap`}>
      {show && (
        <div className='flex dark:bg-black fixed flex-col cursor-pointer  items-start p-4 right-0 transform -translate-x-[12%] -translate-y-[60%] min-w-[200px] max-w-md bg-gray-700 rounded-lg shadow-lg mt-[-8px]'>
          <p className=''>+ Add a Model</p>
          {models.map((model) => (
            <div
              key={model.id}
              className={`flex items-center justify-between w-full py-1 p-3 rounded-sm hover:bg-gray-600 cursor-pointer ${
                selectedModel === model.id ? 'bg-blue-600' : ''
              }`}
              onClick={() => {
                setSelectedModel(model.id);
                setShow(false);
              }}
            >
              <p>{model.name}</p>
              {selectedModel === model.id && (
                <span className='text-green-500'>&#10003;</span>
              )}
            </div>
          ))}
        </div>
      )}
      <div className='web flex items-center justify-center gap-1'>
        <p>Search Web</p>
        <input
          type='radio'
          name='web'
          className='w-4 h-4 hover:cursor-pointer'
        />
      </div>
      <div className={`modelSelection flex `} onClick={toggleModelDialog}>
        <p>
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
