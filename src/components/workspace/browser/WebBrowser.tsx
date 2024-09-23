'use client';

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

const WebBrowser = () => {
  const [query, setQuery] = useState('https://example.com');
  const [content, setContent] = useState('');
  const [currentUrl, setCurrentUrl] = useState('');

  const fetchWebContent = async () => {
    setContent('Loading...');
    try {
      const response = await fetch('/api/fetch-web-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: query }),
      });
      const result = await response.json();

      if (result.html) {
        setContent(result.html);
        setCurrentUrl(result.finalUrl);
        setQuery(result.finalUrl);
      } else if (result.type === 'search') {
        setContent(formatSearchResults(result.results));
      }
    } catch (error: any) {
      setContent(`Error: ${error.message}`);
    }
  };

  const formatSearchResults = (results: any) => {
    return results
      .map(
        (result: any, index: any) => `
      <div key=${index} class="mb-4">
        <h3 class="text-xl font-bold">
          <a href="#" data-url="${result.FirstURL}">${result.Text}</a>
        </h3>
        <p>${result.Abstract}</p>
      </div>
    `
      )
      .join('');
  };

  useEffect(() => {
    fetchWebContent();
  }, []);

  const handleLinkClick = (e: any) => {
    if (e.target.tagName === 'A') {
      e.preventDefault();
      const url = e.target.href || e.target.getAttribute('data-url');
      if (url) {
        setQuery(url);
        fetchWebContent();
      }
    }
  };

  return (
    <div className='border rounded-md p-4 h-full flex flex-col'>
      <div className='flex items-center space-x-2 mb-4'>
        <Input
          type='text'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className='flex-grow'
        />
        <Button onClick={fetchWebContent}>Go</Button>
      </div>
      <div className='bg-white p-4 border rounded flex-grow overflow-hidden'>
        <iframe
          srcDoc={content}
          className='w-full h-full'
          style={{ height: '100%', minHeight: '900px' }}
          sandbox='allow-scripts allow-same-origin'
          onLoad={(e) => {
            const iframe = e.target as HTMLIFrameElement;
            if (iframe.contentWindow) {
              iframe.contentWindow.document.body.addEventListener(
                'click',
                handleLinkClick
              );
            }
          }}
        />
      </div>
    </div>
  );
};

export default WebBrowser;
