'use client';
import './globals.css';
import type { Metadata } from 'next';
import { Provider } from 'react-redux';
import { store } from '../store/store';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const meta: Metadata = {
    title: 'Dev Chat',
    description: 'Chat with AI models',
  };

  return (
    <Provider store={store}>
      <html lang='en'>
        <head>
          <meta charSet='utf-8' />
          <meta
            title={meta.title as string}
            name='viewport'
            content='width=device-width,initial-scale=1'
          />
          <meta name='description' content={meta.description as string} />
        </head>
        <body>{children}</body>
      </html>
    </Provider>
  );
}
