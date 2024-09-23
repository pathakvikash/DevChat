/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import ChatArea from '../components/ChatArea';

describe('ChatArea', () => {
  const mockProps = {
    currentSessionId: 1,
    sessions: [
      {
        id: 1,
        name: 'Test Session',
        messages: [
          { id: 1, text: 'Hello', sender: 'user', isComplete: true },
          { id: 2, text: 'Hi there!', sender: 'server', isComplete: true },
        ],
      },
    ],
    newMessage: '',
    setNewMessage: jest.fn(),
    handleSendMessage: jest.fn(),
    handleStopResponse: jest.fn(),
    tags: ['tag1', 'tag2'],
    setSelectedTag: jest.fn(),
  };

  test('renders ChatArea component', () => {
    render(<ChatArea {...mockProps} />);

    expect(screen.getByText('Chat Area - Session 1')).toBeInTheDocument();
  });

  test('renders messages', () => {
    render(<ChatArea {...mockProps} />);

    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there!')).toBeInTheDocument();
  });

  test('renders input field', () => {
    render(<ChatArea {...mockProps} />);

    expect(
      screen.getByPlaceholderText('Type a message...')
    ).toBeInTheDocument();
  });
});
