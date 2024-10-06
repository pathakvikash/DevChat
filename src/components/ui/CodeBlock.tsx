import React from 'react';
import Highlight from 'react-highlight.js';
import 'highlight.js/styles/monokai-sublime.css';
import CopyButton from './CopyButton';

interface CodeBlockProps {
  language: string;
  code: string;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ language, code }) => {
  return (
    <div style={{ margin: '1em 0', position: 'relative' }}>
      <div style={{ position: 'absolute', top: '0.5em', right: '0.5em', zIndex: 10 }}>
        <CopyButton content={code} />
      </div>
      <Highlight language={language}>{code}</Highlight>
    </div>
  );
};

export default CodeBlock;
