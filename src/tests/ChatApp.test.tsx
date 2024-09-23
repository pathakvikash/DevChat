/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import configureStore from 'redux-mock-store';
import ChatApp from '../components/ChatApp';
import * as api from '../utils/api';
jest.mock('../utils/api');

const mockStore = configureStore([]);

describe('ChatApp', () => {
  let store;

  beforeEach(() => {
    store = mockStore({
      chat: {
        sessions: [],
        currentSessionId: null,
      },
    });
    (api.fetchTags as jest.Mock).mockResolvedValue([]);
  });

  test('renders ChatApp component', async () => {
    await act(async () => {
      render(
        <Provider store={store}>
          <ChatApp />
        </Provider>
      );
    });

    expect(screen.getByText('DEV CHAT')).toBeInTheDocument();
  });

  test('renders sidebar toggle button', async () => {
    await act(async () => {
      render(
        <Provider store={store}>
          <ChatApp />
        </Provider>
      );
    });

    expect(screen.getByRole('button', { name: /toggle sidebar/i })).toBeInTheDocument();
  });
});
