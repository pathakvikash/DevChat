export async function fetchTags() {
  const response = await fetch('http://localhost:11434/api/tags');
  const data = await response.json();
  return data.models;
}

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
