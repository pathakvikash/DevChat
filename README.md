This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/basic-features/font-optimization) to automatically optimize and load Inter, a custom Google Font.

## LLM providers

DevChat is bring-your-own-key. It talks to any provider that speaks the OpenAI
Chat Completions format, discovers which ones you have access to, and fetches
their live model lists.

| Provider | Env var | Notes |
|---|---|---|
| Ollama | `OLLAMA_BASE_URL` | Auto-detected when reachable, no key needed |
| OpenAI | `OPENAI_API_KEY` | `OPENAI_BASE_URL` to use a proxy |
| Anthropic | `ANTHROPIC_API_KEY` | via Anthropic's OpenAI-compatible endpoint |
| Google Gemini | `GOOGLE_API_KEY` | Google AI Studio key |
| OpenRouter | `OPENROUTER_API_KEY` | free models only by default |
| NVIDIA NIM | `NVIDIA_NIM_API_KEY` | `NVIDIA_NIM_BASE_URL` for self-hosted NIMs |
| Custom | `CUSTOM_BASE_URL`, `CUSTOM_API_KEY` | Groq, Together, DeepSeek, xAI, Mistral, LM Studio, vLLM, a remote Ollama... |

Two ways to configure them:

1. **Env vars** (`.env` locally, project settings on Vercel). Server-wide, shared
   by every user of that deployment. Copy `.env.example` to get started.
2. **Settings page** in the app. Per user, encrypted at rest with `AUTH_SECRET`.
   A key saved here overrides the env var for that user, so a public Vercel
   deployment works with no provider keys set at all: each person signs in and
   adds their own.

The Settings page shows each provider's status (configured by the deployment,
N models available, or the error the provider returned), and the model picker
lists everything reachable, grouped by provider.

**Reusing keys you already have.** Settings has a "Find providers on this
machine" section that imports API keys other tools already store (Codex CLI,
Claude Code, Gemini CLI, OpenCode, bb, shell profiles). You always review what
was found, shown masked with its source file, and pick what to import. OAuth
logins (Claude Code, Codex or Gemini subscription tokens) are never read, since
those are licensed to the tool that issued them.

- **Running locally** (`npm run dev`): click **Scan this machine**. The server
  reads the files directly. Set `ALLOW_PROVIDER_DETECTION=1` to enable this for
  a local production build; never on a shared server.
- **Hosted** (Vercel or any remote server): the site can't see your computer, so
  click **Connect this computer**. It shows a one-line command with a one-time
  code, valid for 10 minutes:

  ```bash
  curl -fsSL https://your-app/api/providers/pair/script | node - <code>
  ```

  The script runs on your machine, asks yes/no for each key it finds, and sends
  only the approved ones to your account. The page updates by itself. Add
  `--list` to just see what it would find, or `--yes` to import everything. The
  code can only add API keys for known providers; it can never change a base
  URL, so a leaked code can't redirect your chats.

**Using Claude Code, Codex or OpenCode directly.** When DevChat runs on your
own machine and one of those commands is installed, it shows up as a provider in
the model selector (Claude Code: Default/Sonnet/Opus/Haiku; Codex: your default;
OpenCode: whatever `opencode models` lists). DevChat launches the tool in
headless mode for each turn and streams its reply, so the tool uses its own
login, including a Claude or ChatGPT subscription, and no API key is involved.
This is how [bb](https://github.com/get-bb/bb) works too. Details:

- The tool runs with its own file, shell and web tools disabled, in a scratch
  directory. DevChat's own tools (web search, knowledge bases, todos, MCP, ...)
  still work: they are described to the model in the prompt, a reply ending in
  a ```tool_call block is run by DevChat, and the result goes back in the next
  turn. Each tool step is a fresh run of the CLI, so tool-heavy turns are
  slower than with an API provider.
- Claude Code is started with your hooks and settings skipped and DevChat's
  system prompt in place of its coding-agent prompt.
- DevChat's own provider keys from `.env` are kept out of the tool's
  environment, so the tool always uses its own login. (Claude Code otherwise
  prefers `ANTHROPIC_API_KEY` and retries a bad key forever.) A tool that
  prints nothing for two minutes, or keeps retrying its API, is stopped with a
  clear error instead of hanging the chat.
- **Reasoning effort** (model settings dialog, shown for these models): Low,
  Medium, High or Max maps to Claude Code `--effort`, OpenCode `--variant` and
  Codex `model_reasoning_effort`. **Thinking** is shown where the tool exposes
  it: OpenCode streams the actual reasoning text; Claude Code only reports how
  many thinking tokens it used, so that is what the thinking block says.
- The Codex adapter follows Codex's documented `codex exec --json` output but
  hasn't been exercised here; report issues if it misbehaves.
- This is for personal use on your own machine and is subject to each tool's
  own terms. Never expose such a DevChat instance to other users: they would be
  chatting on your subscriptions.

To add another hosted provider, append one entry to `PROVIDERS` in
[`src/lib/providers.ts`](src/lib/providers.ts). No other code changes needed.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/deployment) for more details.
