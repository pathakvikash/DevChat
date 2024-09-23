import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { sendMessage, updateLastMessage } from '../store/slice/chatSlice';
import { sendPromptRequest } from '../utils/api';

export const useMessageHandling = (currentSessionId: number | null) => {
  const dispatch = useDispatch();
  const [newMessage, setNewMessage] = useState('');

  const handleSendMessage = async () => {
    if (newMessage.trim() === '' || !currentSessionId)
      return { controller: null, promise: Promise.resolve() };

    dispatch(
      sendMessage({
        sessionId: currentSessionId,
        text: newMessage,
        role: 'user',
      })
    );
    setNewMessage('');

    const controller = new AbortController();
    const promise = processServerResponse(controller.signal);

    return { controller, promise };
  };

  const processServerResponse = async (signal: AbortSignal): Promise<void> => {
    try {
      const response = await sendPromptRequest({
        model: 'qwen2:1.5b',
        prompt: newMessage,
        system: 'You are a helpful assistant.',
        context: [],
        signal,
      });

      dispatch(
        sendMessage({ sessionId: currentSessionId!, text: '', role: 'server' })
      );

      await streamResponse(response.body?.getReader(), signal);
    } catch (error: unknown) {
      console.error('Error sending message:', error);
    }
  };

  const streamResponse = async (
    reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
    signal: AbortSignal
  ) => {
    let serverResponse = '';

    while (!signal.aborted) {
      const { value, done } = (await reader?.read()) ?? {};
      if (done) break;

      serverResponse = processChunk(
        new TextDecoder().decode(value),
        serverResponse
      );
    }
  };

  const processChunk = (chunk: string, serverResponse: string): string => {
    const lines = chunk.split('\n').filter((line) => line.trim() !== '');

    for (const line of lines) {
      try {
        const { response, done } = JSON.parse(line);
        if (response) {
          serverResponse += response;
          updateServerResponse(serverResponse, false);
        }
        if (done) {
          updateServerResponse(serverResponse, true);
          return serverResponse;
        }
      } catch (error) {
        console.error('Error processing response:', error);
      }
    }

    return serverResponse;
  };

  const updateServerResponse = (text: string, isComplete: boolean) => {
    dispatch(
      updateLastMessage({ sessionId: currentSessionId!, text, isComplete })
    );
  };

  return {
    newMessage,
    setNewMessage,
    handleSendMessage,
  };
};
