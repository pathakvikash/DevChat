'use client';
import './globals.css';
import type { Metadata } from 'next';
import { Provider } from 'react-redux';
import store from '../../store/store';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Provider store={store}>
      {/* <AppThemeContextProvider> */}
      <html lang='en' className=''>
        <body>{children}</body>
      </html>
      {/* </AppThemeContextProvider> */}
    </Provider>
  );
}
