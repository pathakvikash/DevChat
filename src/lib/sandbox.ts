"use client";

const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
// The Run frame's own policy, on top of the page's: no network. Python may fetch only Pyodide's own folder.
export const RUN_CSP = {
  javascript: "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'",
  python: `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' ${PYODIDE}; connect-src ${PYODIDE}`,
} as const;

const PYTHON_BODY = `<script src="${PYODIDE}pyodide.js"><\/script><script>
  let ready;
  let queue = Promise.resolve();
  const start = () => (ready ||= loadPyodide({ indexURL: '${PYODIDE}' }).catch((e) => { ready = null; throw e; }));
  async function run(code) {
    let py;
    try { py = await start(); } catch (e) { return 'Error: ' + (e && e.message ? e.message : String(e)); }
    try {
      await py.loadPackagesFromImports(code);
    } catch (e) {
      return 'Could not load package(s) for imports: ' + (e && e.message ? e.message : String(e));
    }
    py.runPython('import sys, io\\nsys.stdout = io.StringIO()\\nsys.stderr = io.StringIO()');
    let result;
    let err = null;
    try {
      result = await py.runPythonAsync(code);
    } catch (e) {
      err = e && e.message ? e.message : String(e);
    }
    const stdout = py.runPython('sys.stdout.getvalue()');
    const stderr = py.runPython('sys.stderr.getvalue()');
    const parts = [];
    if (stdout) parts.push(stdout);
    if (stderr) parts.push(stderr);
    if (result !== undefined && result !== null && !err) parts.push(String(result));
    if (err) parts.push('Error: ' + err);
    return parts.join('').trimEnd() || '(no output)';
  }
  window.addEventListener('message', (e) => {
    if (e.source !== parent || !e.data || typeof e.data.code !== 'string') return;
    const { channel, code } = e.data;
    queue = queue.then(() => run(code)).catch((e) => 'Error: ' + (e && e.message ? e.message : String(e))).then((output) => parent.postMessage({ channel, output }, '*'));
  });
<\/script>`;

function javascriptBody(code: string, channel: string) {
  const sanitized = code.replace(/<\/script/gi, "<\\/script");
  return `<script>
      (async () => {
        const logs = [];
        const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
        const fmt = (a) => {
          try { return typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a); }
          catch { return String(a); }
        };
        ['log','error','warn','info'].forEach(k => {
          console[k] = (...args) => { logs.push(args.map(fmt).join(' ')); try{orig[k](...args)}catch{} };
        });
        let result;
        try {
          result = await (async () => { ${sanitized} })();
        } catch (e) {
          logs.push('Error: ' + (e && e.message ? e.message : String(e)));
        }
        if (result !== undefined) logs.push(fmt(result));
        parent.postMessage({ channel: '${channel}', output: logs.join('\\n') }, '*');
      })();
    <\/script>`;
}

// The page a Run frame loads: its own CSP comes first, so nothing after it can run before the policy applies.
export function runDocument(lang: "python" | "javascript", code: string, channel: string): string {
  const body = lang === "python" ? PYTHON_BODY : javascriptBody(code, channel);
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${RUN_CSP[lang]}"></head><body>${body}</body></html>`;
}

function hiddenFrame(html: string, onLoad?: () => void) {
  const iframe = document.createElement("iframe");
  iframe.sandbox.add("allow-scripts");
  iframe.style.display = "none";
  if (onLoad) iframe.addEventListener("load", onLoad, { once: true });
  iframe.srcdoc = html;
  document.body.appendChild(iframe);
  return iframe;
}

// Waits for the frame's reply on `channel`; start() sends the work once the listener is in place.
function reply(iframe: HTMLIFrameElement, channel: string, timeoutMs: number, start: () => void): Promise<string> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", handler);
      iframe.remove();
      resolve(`Error: execution timed out (${timeoutMs}ms)`);
    }, timeoutMs);

    function handler(e: MessageEvent) {
      if (e.source !== iframe.contentWindow || e.data?.channel !== channel) return;
      clearTimeout(timer);
      window.removeEventListener("message", handler);
      resolve((typeof e.data.output === "string" && e.data.output) || "(no output)");
    }
    window.addEventListener("message", handler);
    start();
  });
}

const newChannel = () => `vas-sandbox-${Math.random().toString(36).slice(2)}`;

// One Python frame for the chat's Runs: Pyodide loads once and variables persist between Runs.
// ponytail: one Python frame at a time; a Run in another chat replaces it, and a Run still waiting there times out. One frame per chat if split view needs it.
let pythonFrame: { iframe: HTMLIFrameElement; scope: string; loaded: boolean } | null = null;

function runPython(code: string, scope: string, timeoutMs = 120_000): Promise<string> {
  const channel = newChannel();
  if (pythonFrame && pythonFrame.scope !== scope) {
    pythonFrame.iframe.remove();
    pythonFrame = null;
  }
  if (!pythonFrame) {
    const frame = { iframe: hiddenFrame(runDocument("python", "", ""), () => (frame.loaded = true)), scope, loaded: false };
    pythonFrame = frame;
  }
  const frame = pythonFrame;
  const post = () => frame.iframe.contentWindow?.postMessage({ channel, code }, "*");
  return reply(frame.iframe, channel, timeoutMs, () => (frame.loaded ? post() : frame.iframe.addEventListener("load", post, { once: true }))).finally(
    () => {
      // A timed-out frame is already removed; forget it so the next Run starts fresh.
      if (!frame.iframe.isConnected && pythonFrame === frame) pythonFrame = null;
    },
  );
}

function runJavaScript(code: string, timeoutMs = 5000): Promise<string> {
  if (code.length > 10000) {
    return Promise.resolve(`Error: code exceeds 10,000 character limit (${code.length} chars).`);
  }
  const channel = newChannel();
  const iframe = hiddenFrame(runDocument("javascript", code, channel));
  return reply(iframe, channel, timeoutMs, () => {}).finally(() => iframe.remove());
}

export function isExecutableLanguage(lang: string): "python" | "javascript" | null {
  const l = lang.toLowerCase();
  if (l === "python" || l === "py") return "python";
  if (l === "javascript" || l === "js") return "javascript";
  return null;
}

// `scope` is the conversation id: Python state is kept per chat. No chat shares one frame.
export async function runCode(language: string, code: string, scope = ""): Promise<string> {
  const lang = isExecutableLanguage(language);
  if (lang === "python") return runPython(code, scope);
  if (lang === "javascript") return runJavaScript(code);
  throw new Error(`Language not executable: ${language}`);
}
