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
      <Highlight language={language}>{code}</Highlight>
      <CopyButton content={code} />
    </div>
  );
};

export default CodeBlock;
