import React, { useState, useEffect, useRef } from 'react';

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

  return <span>{displayedText}</span>;
};

export default React.memo(TextEffect);
