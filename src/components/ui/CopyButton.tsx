import React, { useState } from 'react';
import { Copy } from 'lucide-react';
interface CopyButtonProps {
  content: string;
}

const CopyButton: React.FC<CopyButtonProps> = ({ content }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button className='p-1' onClick={handleCopy}>
        <Copy />
      </button>
      {copied && (
        <div
          style={{
            position: 'absolute',
            backgroundColor: '#333',
            color: '#fff',
            borderRadius: '4px',
            padding: '6px 12px',
            fontSize: '12px',
            boxShadow: '0px 2px 6px rgba(0, 0, 0, 0.2)',
            opacity: copied ? 1 : 0,
            transition: 'opacity 0.5s ease',
          }}
        >
          Copied!
        </div>
      )}
    </div>
  );
};
export default CopyButton;
