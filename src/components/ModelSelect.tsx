'use client';
import { useState, useEffect } from 'react';

interface ModelSelectProps {
  setSelectedTag: React.Dispatch<React.SetStateAction<string>>;
  tags: (string | { [key: string]: any; name: string })[];
}

const ModelSelect: React.FC<ModelSelectProps> = ({ setSelectedTag, tags }) => {
  const [selectedModel, setSelectedModel] = useState<string>('qwen2:1.5b');
  const [show, setShow] = useState(false);
  const [isWebSearch, setIsWebSearch] = useState(false);

  useEffect(() => {
    setSelectedTag(selectedModel);
  }, [selectedModel, setSelectedTag]);

  const toggleModelDialog = () => {
    setShow(!show);
  };

  const handleModelSelect = (model: string) => {
    setSelectedModel(model);
    setShow(false);
  };

  const toggleWebSearch = () => {
    setIsWebSearch(!isWebSearch);
    // logic to handle web search activation
  };

  return (
    <div className='flex p-3 justify-between items-center flex-wrap'>
      {show && (
        <div className='flex dark:bg-black fixed flex-col cursor-pointer items-start p-4 right-0 transform -translate-x-[12%] -translate-y-[60%] min-w-[200px] max-w-md bg-gray-700 rounded-lg shadow-lg mt-[-8px] z-10'>
          <p className=''>+ Add a Model</p>
          {tags.map((model: any) => (
            <div
              key={model.name}
              className={`flex items-center justify-between w-full py-1 p-3 rounded-sm hover:bg-gray-600 cursor-pointer ${
                selectedModel === model.name ? 'bg-blue-600' : ''
              }`}
              onClick={() => handleModelSelect(model.name)}
            >
              <p>{model.name}</p>
              {selectedModel === model.name && (
                <span className='text-green-500'>&#10003;</span>
              )}
            </div>
          ))}
        </div>
      )}
      <div className='web flex items-center justify-center gap-1'>
        <p>Search Web</p>
        <input
          type='checkbox'
          checked={isWebSearch}
          onChange={toggleWebSearch}
          className='w-4 h-4 hover:cursor-pointer'
        />
      </div>
      <div className='modelSelection flex' onClick={toggleModelDialog}>
        Models:{' '}
        <div className='dark:bg-[#3f4a6b] rounded-md px-1 flex ml-2'>
          {selectedModel}
        </div>
      </div>
    </div>
  );
};

export default ModelSelect;