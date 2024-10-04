import React, { useState, useEffect, useRef } from 'react';
import CodeBlock from './ui/CodeBlock';
import CopyButton from './ui/CopyButton';
import './textEffect.css';

interface TextEffectProps {
  text: string;
  isComplete: boolean;
  effect: 'streaming' | 'typewriter';
  speed?: number;
}

const TextEffect: React.FC<TextEffectProps> = ({
  text,
  isComplete,
  effect,
  speed = 20,
}) => {
  const [displayedText, setDisplayedText] = useState('');
  const indexRef = useRef(0);

  useEffect(() => {
    if (effect === 'streaming') {
      setDisplayedText(text);
    } else if (effect === 'typewriter' && !isComplete) {
      indexRef.current = 0;
      setDisplayedText('');
      const intervalId = setInterval(() => {
        if (indexRef.current < text.length) {
          setDisplayedText((prev) => prev + text[indexRef.current]);
          indexRef.current++;
        } else {
          clearInterval(intervalId);
        }
      }, speed);
      return () => clearInterval(intervalId);
    }
  }, [text, isComplete, effect, speed]);

  const formatText = (text: string) => {
    const codeBlockRegex = /```(.*?)\n([\s\S]*?)```/gs;
    return text.split(codeBlockRegex).map((part, index) => {
      if (index % 3 === 2) {
        const language = part.trim();
        const code = part;
        return <CodeBlock key={index} language={language} code={code} />;
      }
      return <span key={index}>{part}</span>;
    });
  };

  return (
    <div>
      <span className='flex flex-col gap-3 max-w-[900px]'>
        {formatText(displayedText)}
      </span>
      <CopyButton content={displayedText} />
    </div>
  );
};

export default React.memo(TextEffect);
