import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  editMessage,
  sendMessage,
  updateLastMessage,
} from '../store/slice/chatSlice';
import { sendPromptRequest } from '../utils/api';
import {
  selectSessions,
  selectCurrentSessionId,
} from '../store/slice/chatSlice';
import { useSessionManagement } from './useSessionManagement';

export const useMessageHandling = (currentSessionId: number | null) => {
  const dispatch = useDispatch();
  const sessions = useSelector(selectSessions);
  const { updateSessionName } = useSessionManagement();
  const [newMessage, setNewMessage] = useState('');
  const [selectedModel, setSelectedModel] = useState('qwen2:1.5b');

  const generateSessionTitle = async (message: string): Promise<string> => {
    try {
      const response = await sendPromptRequest({
        model: selectedModel,
        prompt: `Generate a short, concise title (max 5 words) for this message: "${message}"`,
        signal: new AbortController().signal,
        system: '',
        context: [],
      });

      const reader = response.body?.getReader();
      let title = '';
      while (true) {
        const { done, value } = (await reader?.read()) ?? {};
        if (done) break;
        const chunk = new TextDecoder().decode(value);
        const lines = chunk.split('\n').filter((line) => line.trim() !== '');
        for (const line of lines) {
          const { response } = JSON.parse(line);
          if (response) {
            title += response;
          }
        }
      }
      // Remove quotation marks and trim whitespace
      const formattedTitle = title.replace(/["']/g, '').trim();
      return formattedTitle || 'Untitled Conversation';
    } catch (error) {
      console.error('Error generating title:', error);
      return 'Untitled Conversation';
    }
  };

  const handleSendMessage = async (
    messageText: string = newMessage,
    isRegenerate: boolean = false,
    regenerateMessageId?: number,
    systemPrompt: string = ''
  ) => {
    if (messageText.trim() === '' || !currentSessionId) {
      return { controller: null, promise: Promise.resolve() };
    }

    const formattedMessage = messageText.replace(/\n/g, '<br>');

    if (!isRegenerate) {
      dispatch(
        sendMessage({
          sessionId: currentSessionId,
          text: formattedMessage,
          role: 'user',
        })
      );

      const session = sessions.find((s) => s.id === currentSessionId);
      if (session && session.messages.length === 0) {
        const title = await generateSessionTitle(messageText);
        updateSessionName(title);
      }
    }
    setNewMessage('');

    const controller = new AbortController();
    const promise = processServerResponse(
      controller.signal,
      messageText,
      regenerateMessageId,
      systemPrompt
    );

    return { controller, promise };
  };

  const processServerResponse = async (
    signal: AbortSignal,
    prompt: string,
    regenerateMessageId?: number,
    systemPrompt: string = ''
  ): Promise<void> => {
    try {
      const response = await sendPromptRequest({
        model: selectedModel,
        prompt: prompt,
        signal,
        system: systemPrompt,
        context: [],
      });

      if (!regenerateMessageId) {
        dispatch(
          sendMessage({
            sessionId: currentSessionId!,
            text: '',
            role: 'server',
          })
        );
      }

      await streamResponse(
        response.body?.getReader(),
        signal,
        regenerateMessageId
      );
    } catch (error: unknown) {
      console.error('Error sending message:', error);
    }
  };

  const streamResponse = async (
    reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
    signal: AbortSignal,
    regenerateMessageId?: number
  ) => {
    let serverResponse = '';

    while (!signal.aborted) {
      const { value, done } = (await reader?.read()) ?? {};
      if (done) break;

      serverResponse = processChunk(
        new TextDecoder().decode(value),
        serverResponse,
        regenerateMessageId
      );
    }
  };

  const processChunk = (
    chunk: string,
    serverResponse: string,
    regenerateMessageId?: number
  ): string => {
    const lines = chunk.split('\n').filter((line) => line.trim() !== '');

    for (const line of lines) {
      try {
        const { response, done } = JSON.parse(line);
        if (response) {
          const formattedResponse = formatResponse(response);
          serverResponse += formattedResponse;
          updateServerResponse(serverResponse, false, regenerateMessageId);
        }
        if (done) {
          updateServerResponse(serverResponse, true, regenerateMessageId);
          return serverResponse;
        }
      } catch (error) {
        console.error('Error processing response:', error);
      }
    }

    return serverResponse;
  };

  const formatResponse = (response: string): string => {
    return response;
  };

  const updateServerResponse = (
    text: string,
    isComplete: boolean,
    regenerateMessageId?: number
  ) => {
    dispatch(
      updateLastMessage({
        sessionId: currentSessionId!,
        messageId: regenerateMessageId,
        text,
        isComplete,
      })
    );
  };

  const handleEditMessage = (
    sessionId: number,
    messageId: number,
    text: string
  ) => {
    dispatch(
      editMessage({
        sessionId,
        messageId,
        text,
      })
    );
  };

  return {
    newMessage,
    setNewMessage,
    handleSendMessage,
    handleEditMessage,
    selectedModel,
    setSelectedModel,
    updateSessionName,
  };
};