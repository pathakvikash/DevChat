import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CodeBlock from './ui/CodeBlock';
import CopyButton from './ui/CopyButton';
import './textEffect.css';
import { LoaderPinwheel } from 'lucide-react';

interface TextEffectProps {
  text: string;
  isComplete: boolean;
  effect: 'streaming' | 'typewriter';
  speed?: number;
  onRegenerate?: () => void;
}

const TextEffect: React.FC<TextEffectProps> = ({
  text,
  isComplete,
  effect,
  speed = 20,
  onRegenerate,
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

  const renderMarkdown = (content: string) => {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({node, ...props}) => <h1 className="text-2xl font-bold mt-4 mb-2" {...props} />,
          h2: ({node, ...props}) => <h2 className="text-xl font-bold mt-3 mb-2" {...props} />,
          h3: ({node, ...props}) => <h3 className="text-lg font-bold mt-2 mb-1" {...props} />,
          p: ({node, ...props}) => <p className="mb-2" {...props} />,
          ul: ({node, ...props}) => <ul className="list-disc list-inside mb-2" {...props} />,
          ol: ({node, ...props}) => <ol className="list-decimal list-inside mb-2" {...props} />,
          li: ({node, ...props}) => <li className="ml-4" {...props} />,
          a: ({node, ...props}) => <a className="text-blue-500 hover:underline" {...props} />,
          strong: ({node, ...props}) => <strong className="font-bold" {...props} />,
          em: ({node, ...props}) => <em className="italic" {...props} />,
          code({node, inline, className, children, ...props}) {
            const match = /language-(\w+)/.exec(className || '');
            return !inline && match ? (
              <CodeBlock
                language={match[1]}
                code={String(children).replace(/\n$/, '')}
              />
            ) : (
              <code className={`bg-gray-200 rounded px-1 ${className}`} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    );
  };

  return (
    <div className="markdown-content">
      <span className="flex flex-col gap-3 max-w-[900px]">
        {renderMarkdown(displayedText)}
      </span>
      {isComplete && onRegenerate && (
        <div className="mt-2 flex justify-between">
          <CopyButton content={displayedText} />
          <button
            className="p-1 rounded-full hover:bg-gray-700"
            onClick={onRegenerate}
            title="Regenerate"
          >
            <LoaderPinwheel />
          </button>
        </div>
      )}
    </div>
  );
};

export default React.memo(TextEffect);
