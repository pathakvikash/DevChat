/**
 * Copy for the public marketing pages. Pure data (no imports) so the edge middleware, the sitemap and the pages
 * can all read it. Every claim here was checked against the code; see the notes in each section.
 */
export type Section = "features" | "use-cases";

export interface MarketingPage {
  section: Section;
  slug: string;
  /** Full <title>, under 60 characters, search term first. */
  title: string;
  /** 140-160 characters. */
  description: string;
  h1: string;
  /** Short name for breadcrumbs and links. */
  label: string;
  /** One sentence under the landing link. */
  blurb: string;
  intro: string;
  sections: { h2: string; p: string; bullets: string[] }[];
  faq: { q: string; a: string }[];
  /** Paths of 2-3 related pages. */
  related: string[];
  /** A capture of the real app made by `npm run marketing:shots` (scripts/marketing-shots.spec.ts), saved in /public/marketing. */
  screenshot: { src: string; alt: string; width: number; height: number };
}

export const MARKETING_PAGES: readonly MarketingPage[] = [
  {
    section: "features",
    slug: "agents",
    title: "AI Agent That Does Tasks: Agent Mode | Orrery",
    description:
      "Orrery's Agent mode is an agentic AI assistant that works with tools. Compare Ask and Agent mode, confirm each change before it runs, or plan first.",
    h1: "An AI agent that does tasks, with you in control",
    label: "AI agents",
    blurb: "Ask for answers, or let Agent mode make changes, with approvals and a plan first when you want them.",
    intro:
      "Orrery has two modes under the message box. Ask answers questions. Agent goes further and uses tools to change things. Two options keep you in charge of how far it goes.",
    sections: [
      {
        h2: "Ask vs Agent mode",
        p: "Ask is read-only. Agent can make changes. Switch with one click and the choice is remembered for that conversation.",
        bullets: [
          "Ask answers with read-only tools: web search, your knowledge base and running code.",
          "Agent can also create artifacts and todos, save memory, use connected MCP tools and work with files.",
          "Both work with cloud models and local models.",
        ],
      },
      {
        h2: "Confirm each change",
        p: "Turn on Confirm each change and every tool that would change something waits for you first.",
        bullets: [
          "A card shows the call with Allow and Deny buttons.",
          "Allow for this chat approves that tool for the rest of the conversation.",
          "Deny tells the model the call did not run, and it carries on without it.",
        ],
      },
      {
        h2: "Plan first",
        p: "Turn on Plan first and the model works out the steps and ends with a plan card instead of acting.",
        bullets: [
          "Nothing is changed while it plans.",
          "Read the plan, then switch to Agent mode to let it work.",
        ],
      },
    ],
    faq: [
      {
        q: "What is the difference between Ask and Agent mode?",
        a: "Ask is read-only: the model can search the web, read your knowledge base and run code, but it cannot change anything. Agent mode can also create artifacts and todos, save memory, use connected MCP tools and work with files.",
      },
      {
        q: "Can I approve each change before it happens?",
        a: "Yes. Confirm each change shows an Allow or Deny card before a changing tool runs. You can allow a tool for the rest of the chat once you trust it.",
      },
      {
        q: "What does Plan first do?",
        a: "The model lays out its plan and ends with a plan card. It does not make changes while planning.",
      },
      {
        q: "Which models can I use with Agent mode?",
        a: "Any model Orrery supports. Tool use depends on what the chosen model can do, so a small local model may manage fewer steps than a large cloud one.",
      },
    ],
    related: ["/features/workflows", "/features/apps", "/use-cases/research"],
    screenshot: { src: "/marketing/agents.webp", alt: "Orrery in Agent mode with Confirm each change on: a card asks to create a document called Offsite checklist, with Deny, Allow for this chat and Allow buttons", width: 1280, height: 800 },
  },
  {
    section: "features",
    slug: "workflows",
    title: "Automate Workflows With AI: Workflow Builder | Orrery",
    description:
      "Build a no-code AI workflow on a canvas in Orrery: describe it or start from a template, connect cards for search, agents and tables, then run it.",
    h1: "Automate workflows with an AI workflow builder",
    label: "AI workflows",
    blurb: "Describe a job, or start from a template, and run it as cards on a canvas.",
    intro:
      "A workflow is a chain of cards on a canvas. Each card does one step, such as searching the web, asking a model, filtering rows or saving to a table. You build it without writing code.",
    sections: [
      {
        h2: "The workflow canvas",
        p: "Add cards, connect them and fill in each card's settings in a side panel.",
        bullets: [
          "Cards include web search, an AI agent step, fetch a URL, filter, save to a table, an MCP tool, sync to a Google Sheet, job boards, pick rows and send to chat.",
          "Every workflow starts from a Run manually card.",
          "Use values from earlier cards in later ones.",
        ],
      },
      {
        h2: "Describe it, or start from a template",
        p: "Type what you want in Describe your flow and a model drafts the cards for you to edit. Or pick a template.",
        bullets: [
          "News digest: search the web for your topics, have a model write a digest and post it to a new chat.",
          "Jobs: read company job boards, pick the jobs you like and get a draft application for each. You submit it yourself.",
          "Explain a GitHub repo: read a public repository and explain it with diagrams.",
          "Explain a project folder: local installs only.",
        ],
      },
      {
        h2: "Runs",
        p: "Press Run to start a workflow, watch each card as it works, and open earlier runs from the Runs panel.",
        bullets: [
          "Runs start when you press Run. Scheduled runs are not available yet.",
          "Each past run opens read-only, newest first.",
        ],
      },
    ],
    faq: [
      {
        q: "Do I need to code to build an AI workflow?",
        a: "No. You connect cards on a canvas and fill in their settings, or describe the job in plain words and edit the draft a model makes.",
      },
      {
        q: "Are there templates?",
        a: "Yes: a blank workflow, News digest, Jobs, Explain a GitHub repo and Explain a project folder, which needs a folder on the machine running Orrery.",
      },
      {
        q: "Can a workflow run on a schedule?",
        a: "Not yet. A workflow runs when you press Run.",
      },
      {
        q: "Can a workflow use my other apps?",
        a: "It can call MCP tools and sync rows to a Google Sheet. Both are set up in Orrery's settings first.",
      },
    ],
    related: ["/features/agents", "/features/apps", "/use-cases/research"],
    screenshot: { src: "/marketing/workflows.webp", alt: "The News digest workflow in Orrery: cards from Run manually through Search the news and Write the digest to Post to a chat, each marked Done", width: 1280, height: 800 },
  },
  {
    section: "features",
    slug: "visuals",
    title: "AI Chart Generator and Diagram Maker | Orrery",
    description:
      "Turn data into charts, Mermaid diagrams and 3D STL views inside an Orrery chat. Visual explanations and artifacts open beside the conversation.",
    h1: "Charts, diagrams and 3D views inside your chat",
    label: "charts and diagrams",
    blurb: "Get charts, Mermaid diagrams, 3D views and artifacts instead of a wall of text.",
    intro:
      "Orrery can answer with something you look at instead of something you read. Charts, diagrams, tables and previews appear in the conversation or open beside it.",
    sections: [
      {
        h2: "Charts from your data",
        p: "A model can draw bar, line, area and pie charts, and candlestick charts for price data.",
        bullets: [
          "Run Python with pandas on a file you attach, then chart the result.",
          "Large datasets are saved as a data artifact and charted from there, so rows are not retyped.",
          "Tables render as real tables.",
        ],
      },
      {
        h2: "Mermaid diagrams",
        p: "Ask for a flowchart, sequence or other diagram and it is drawn in the chat.",
        bullets: ["Good for processes, architectures and timelines.", "Ask the model to change it and it redraws."],
      },
      {
        h2: "3D STL viewer",
        p: "A connected app can return an STL file, and Orrery shows it in an interactive 3D viewer.",
        bullets: [
          "Orbit and zoom the model in the chat.",
          "If WebGL is not available, you get a download link instead.",
          "Orrery displays models that apps give it. It does not generate 3D models itself.",
        ],
      },
      {
        h2: "Artifacts",
        p: "Documents, code, pages and datasets the model writes open in a side panel.",
        bullets: [
          "HTML pages run in an isolated sandbox with no network access.",
          "Artifacts are saved and the model can update them later.",
        ],
      },
    ],
    faq: [
      {
        q: "Can Orrery make a chart from my data?",
        a: "Yes. Attach a file, let the model analyse it with Python, and it can draw bar, line, area or pie charts, or candlesticks for price data.",
      },
      {
        q: "Which diagrams does it draw?",
        a: "Mermaid diagrams, such as flowcharts and sequence diagrams, rendered right in the conversation.",
      },
      {
        q: "Can it generate a 3D model?",
        a: "Orrery itself does not. It shows STL files that a connected app returns, in an interactive viewer.",
      },
      {
        q: "Are generated HTML pages safe to open?",
        a: "HTML artifacts run in an isolated sandbox with no network access, cookies or local storage.",
      },
    ],
    related: ["/use-cases/study", "/features/apps", "/features/agents"],
    screenshot: { src: "/marketing/visuals.webp", alt: "An Orrery chat that answers btc 1m candles with a candlestick chart of 60 one-minute BTC/USDT candles", width: 1280, height: 800 },
  },
  {
    section: "use-cases",
    slug: "study",
    title: "AI Study Assistant With Diagrams and Notes | Orrery",
    description:
      "Use Orrery as an AI study assistant: explain a topic with diagrams and charts, keep notes from your chats, and upload documents to a knowledge base.",
    h1: "An AI study assistant that explains with visuals",
    label: "studying with AI",
    blurb: "Explain a topic with diagrams, keep notes and search your own documents.",
    intro:
      "Learning sticks better when you can see it. Orrery can draw the idea, keep what you want to remember and answer from the documents you upload.",
    sections: [
      {
        h2: "Explain a topic with visuals",
        p: "Ask for a topic and get a diagram or chart alongside the words.",
        bullets: [
          "Ask for a flowchart of how a process works, such as the stages of a cell cycle or a request through a server.",
          "Ask for a chart of numbers you are studying and have it explain the trend.",
          "The Math Tutor skill is built in for working through problems step by step.",
        ],
      },
      {
        h2: "Notes next to your chats",
        p: "Jot notes in a scratchpad beside each chat. The Notes page lists them all.",
        bullets: ["Each conversation can have its own note.", "A search box on the Notes page filters them."],
      },
      {
        h2: "A knowledge base of your own material",
        p: "Upload documents and the chat can search them when you ask a question.",
        bullets: [
          "Create a knowledge base, upload files, and attach it in the chat's settings.",
          "Searching uses embeddings from a local Ollama model, so Ollama must be running with the embedding model pulled.",
        ],
      },
    ],
    faq: [
      {
        q: "Can the AI explain a topic with a diagram?",
        a: "Yes. Ask for a diagram and it draws a Mermaid diagram in the chat. Ask for a chart and it draws one from the numbers.",
      },
      {
        q: "Can I keep notes?",
        a: "Yes. Each conversation can have a note, and the Notes page lists them all with search.",
      },
      {
        q: "Can it answer from my own documents?",
        a: "Yes. Upload documents to a knowledge base and the chat can search them. This needs Ollama running locally for embeddings.",
      },
      {
        q: "Does it replace a teacher?",
        a: "No. Models can be wrong, so check important facts against your course material.",
      },
    ],
    related: ["/features/visuals", "/use-cases/research", "/features/local-models"],
    screenshot: { src: "/marketing/study.webp", alt: "An Orrery chat where a student asks how cells divide and gets a flowchart of the cell cycle: Grow, Copy DNA, Check, Split the DNA, Split the cell, and back to Grow", width: 1280, height: 800 },
  },
  {
    section: "use-cases",
    slug: "research",
    title: "AI Research Assistant That Reads Links | Orrery",
    description:
      "An AI that reads a link and answers: Orrery searches the web, fetches the pages and cites the URLs it used, so you can check each claim yourself.",
    h1: "An AI research assistant that reads links and cites sources",
    label: "AI research",
    blurb: "Search the web, read the pages and get answers with the URLs behind them.",
    intro:
      "Paste a link or ask a question. Orrery can search the web, read the pages it finds and answer with the links it relied on.",
    sections: [
      {
        h2: "Read a link and answer",
        p: "Give the model a URL and it fetches the page and works from the text.",
        bullets: [
          "The Fetch URL tool returns the readable text of a page, up to 8,000 characters.",
          "Public GitHub repositories can be read the same way.",
          "Each fetch shows as a tool card, so you can see what was read.",
        ],
      },
      {
        h2: "Web search",
        p: "The model can search the web and then open the most promising results.",
        bullets: [
          "Search uses DuckDuckGo with no key, or Tavily if you add a key.",
          "The Web Researcher skill searches first, reads one or two pages and cites URLs inline.",
          "It is told to separate what a source says from its own summary.",
        ],
      },
      {
        h2: "Check the sources",
        p: "Answers carry links so you can open the original and verify.",
        bullets: [
          "Fetching reads one page at a time and cuts long pages at 8,000 characters.",
          "Pages that need a login or that build their content with scripts may come back empty.",
        ],
      },
    ],
    faq: [
      {
        q: "Can Orrery read a link I paste?",
        a: "Yes. The Fetch URL tool reads the page's text, up to 8,000 characters, and the model answers from it.",
      },
      {
        q: "Does it search the web?",
        a: "Yes, through DuckDuckGo with no key, or Tavily with a key.",
      },
      {
        q: "Does it show sources?",
        a: "The Web Researcher skill cites the URLs it used inline, and tool cards show each search and fetch.",
      },
      {
        q: "Can it read pages behind a login?",
        a: "No. It fetches public pages, and some pages built with scripts may return little text.",
      },
    ],
    related: ["/features/agents", "/use-cases/study", "/features/workflows"],
    screenshot: { src: "/marketing/research.webp", alt: "An Orrery chat that read a web page with the fetch URL tool and answered with good-fit and bad-idea lists for SQLite, plus a source link", width: 1280, height: 800 },
  },
  {
    section: "features",
    slug: "local-models",
    title: "Chat UI for Ollama and LM Studio | Orrery",
    description:
      "A web chat UI for Ollama and LM Studio. Orrery finds your Ollama models, connects to LM Studio, and sits beside OpenAI, Anthropic and Gemini.",
    h1: "A chat UI for Ollama and LM Studio",
    label: "local models with Ollama and LM Studio",
    blurb: "Chat with Ollama and LM Studio models next to Anthropic, OpenAI and Gemini.",
    intro:
      "Orrery is a web interface for the models you run yourself, in the same chat as the cloud ones. You can switch model in the middle of a conversation.",
    sections: [
      {
        h2: "Ollama",
        p: "Orrery lists the models your Ollama server has installed.",
        bullets: [
          "It reads the model list from Ollama, by default at localhost:11434.",
          "Set OLLAMA_BASE_URL to point at another Ollama server.",
          "Pull a model with ollama pull and it appears in the model picker.",
        ],
      },
      {
        h2: "LM Studio",
        p: "Start the LM Studio local server and add it in Orrery's settings.",
        bullets: [
          "The default address is http://localhost:1234/v1.",
          "No API key is needed for a local server.",
          "You can change the base URL in settings.",
        ],
      },
      {
        h2: "Every provider in one place",
        p: "Local models sit beside hosted ones.",
        bullets: [
          "OpenAI, Anthropic, Google Gemini, OpenRouter and NVIDIA NIM.",
          "LM Studio, plus any custom OpenAI-compatible endpoint.",
          "Ollama models found on your server.",
        ],
      },
    ],
    faq: [
      {
        q: "Is Orrery a chat UI for Ollama?",
        a: "Yes. It lists the models your Ollama server has and lets you chat with them, with Ask and Agent modes, artifacts and workflows.",
      },
      {
        q: "How do I connect LM Studio?",
        a: "Start LM Studio's local server and add LM Studio in Orrery's settings. The default address is http://localhost:1234/v1 and no key is needed.",
      },
      {
        q: "Does the model run in my browser?",
        a: "No. Orrery's server talks to Ollama or LM Studio, so they need to be reachable from where Orrery runs. A copy of Orrery hosted online cannot reach a server on your own laptop.",
      },
      {
        q: "Can I mix local and cloud models?",
        a: "Yes. Every provider is in the same model picker, and you can change model during a conversation.",
      },
    ],
    related: ["/features/agents", "/features/apps", "/use-cases/study"],
    screenshot: { src: "/marketing/local-models.webp", alt: "The Orrery model picker open on the Ollama tab, listing llama3.2:3b, qwen2.5-coder:7b, mistral:7b and gemma2:9b, with Anthropic and LM Studio tabs beside it", width: 1280, height: 800 },
  },
  {
    section: "features",
    slug: "apps",
    title: "Connect Apps to AI Chat: MCP Client | Orrery",
    description:
      "Connect apps to AI chat with Orrery's MCP-based app registry. Approved apps add tools, charts and 3D views to the conversation, read-only or with approval.",
    h1: "Connect apps to your AI chat with MCP",
    label: "connected apps and MCP",
    blurb: "Connect apps and MCP tools so chats can use your own data and tools.",
    intro:
      "Orrery works as an MCP client web app. An app that publishes a manifest and an MCP endpoint can be registered, and its tools then show up in chat.",
    sections: [
      {
        h2: "How apps connect",
        p: "An owner registers an app by its address. Orrery reads the app's manifest and lists its tools.",
        bullets: [
          "Registration is owner-only and every signed-in user can use approved apps.",
          "Read-only apps are available in Ask mode. Apps that change things ask first.",
          "A changed manifest or tool list needs approval again.",
        ],
      },
      {
        h2: "Results you can see",
        p: "Apps can return structured results, and Orrery picks how to show them.",
        bullets: [
          "Candlestick charts for price data.",
          "An interactive 3D viewer for STL files.",
          "A progress card for long jobs.",
        ],
      },
      {
        h2: "Apps built for Orrery",
        p: "Three sibling apps are designed around this contract. Their availability depends on the apps being registered in your Orrery.",
        bullets: [
          "StatMesh, for analytics.",
          "Print Pro 3D, which returns 3D models as STL files.",
          "Trade MVP, which offers public market data only: read-only, with no portfolio, orders or bots.",
        ],
      },
    ],
    faq: [
      {
        q: "Is Orrery an MCP client?",
        a: "Yes. You can connect MCP tools, and apps that publish an Orrery manifest and an MCP endpoint can be registered.",
      },
      {
        q: "Can an app change my data without asking?",
        a: "Not if it is marked read-only. A tool that is not marked read-only asks for your approval first.",
      },
      {
        q: "Does Orrery generate 3D models or trade for me?",
        a: "No. It shows STL files and market charts that connected apps return. Trade MVP is public market data only, with no orders.",
      },
      {
        q: "Who can add an app?",
        a: "Registering an app is limited to the owner of the Orrery install. Everyone signed in can use the approved ones.",
      },
    ],
    related: ["/features/visuals", "/features/agents", "/features/workflows"],
    screenshot: { src: "/marketing/apps.webp", alt: "An Orrery chat where the answer to "what's btc at right now?" comes from the connected Trade MVP app's get_ticker tool, with Print Pro 3D and Trade MVP listed under Apps in the sidebar", width: 1280, height: 800 },
  },
];

export const pagePath = (p: Pick<MarketingPage, "section" | "slug">) => `/${p.section}/${p.slug}`;
export const MARKETING_PATHS: readonly string[] = MARKETING_PAGES.map(pagePath);
export const findPage = (section: string, slug: string) =>
  MARKETING_PAGES.find((p) => p.section === section && p.slug === slug);
