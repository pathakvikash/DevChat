'use client';

import React, { useState } from 'react';
const TerminalEmulator = () => {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState<string[]>([]);

  const executeCommand = async () => {
    const newOutput = [...output, `$ ${input}`];

    try {
      const response = await fetch(
        'http://localhost:3001/api/execute-command',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: input }),
        }
      );
      const result = await response.json();
      newOutput.push(result.output);
      if (result.error) {
        newOutput.push(`Error: ${result.error}`);
      }
    } catch (error: any) {
      newOutput.push(`Error: ${error.message}`);
    }

    setOutput(newOutput);
    setInput('');
  };

  return (
    <div className='bg-black text-green-400 p-4 rounded-md font-mono h-64 flex flex-col'>
      <div className='flex-grow overflow-y-auto'>
        {output.map((line, index) => (
          <p key={index}>{line}</p>
        ))}
      </div>
      <div className='flex mt-2'>
        <span>$&nbsp;</span>
        <input
          type='text'
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && executeCommand()}
          className='bg-transparent text-green-400 flex-grow outline-none'
        />
      </div>
    </div>
  );
};

export default TerminalEmulator;
