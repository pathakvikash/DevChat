export async function fetchTags() {
  const response = await fetch('http://localhost:11434/api/tags');
  const data = await response.json();
  return data.models;
}

/**
 * Send a request to the LLaMA server to generate text given a prompt, model,
 * system message, and context. The `signal` parameter can be used to abort the
 * request.
 *
 * @param {Object} options - Request options
 * @param {string} options.model - Model identifier
 * @param {string} options.prompt - Prompt to generate text for
 * @param {string} options.system - System message to provide to the model
 * @param {string[]} options.context - Array of context messages to provide to the model
 * @param {AbortSignal} options.signal - Abort signal for the request
 * @return {Promise<Response>} - Response from the server
 */
export async function sendPromptRequest({
  model,
  prompt,
  system,
  context,
  signal,
}) {
  const requestOptions = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      system,
      template: '',
      context,
      options: { temperature: 0.3 },
    }),
    signal,
  };
  return fetch('http://127.0.0.1:11434/api/generate', requestOptions);
}
