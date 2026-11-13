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
  const start = () => (ready ||= loadPyodide({ indexURL: '${PYODIDE}' }));
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
    queue = queue.then(() => run(code)).then((output) => parent.postMessage({ channel, output }, '*'));
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
function reply(channel: string, timeoutMs: number, onTimeout: () => void, start: () => void): Promise<string> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", handler);
      onTimeout();
      resolve(`Error: execution timed out (${timeoutMs}ms)`);
    }, timeoutMs);

    function handler(e: MessageEvent) {
      if (e.data?.channel !== channel) return;
      clearTimeout(timer);
      window.removeEventListener("message", handler);
      resolve(e.data.output || "(no output)");
    }
    window.addEventListener("message", handler);
    start();
  });
}

const newChannel = () => `vas-sandbox-${Math.random().toString(36).slice(2)}`;

// One Python frame for the life of the page: Pyodide loads once and variables persist between Runs.
let pythonFrame: { iframe: HTMLIFrameElement; loaded: boolean } | null = null;

function runPython(code: string, timeoutMs = 120_000): Promise<string> {
  const channel = newChannel();
  if (!pythonFrame) {
    const frame = { iframe: hiddenFrame(runDocument("python", "", ""), () => (frame.loaded = true)), loaded: false };
    pythonFrame = frame;
  }
  const frame = pythonFrame;
  const post = () => frame.iframe.contentWindow?.postMessage({ channel, code }, "*");
  return reply(
    channel,
    timeoutMs,
    () => {
      frame.iframe.remove();
      if (pythonFrame === frame) pythonFrame = null;
    },
    () => (frame.loaded ? post() : frame.iframe.addEventListener("load", post, { once: true })),
  );
}

function runJavaScript(code: string, timeoutMs = 5000): Promise<string> {
  if (code.length > 10000) {
    return Promise.resolve(`Error: code exceeds 10,000 character limit (${code.length} chars).`);
  }
  const channel = newChannel();
  const iframe = hiddenFrame(runDocument("javascript", code, channel));
  return reply(channel, timeoutMs, () => iframe.remove(), () => {}).finally(() => iframe.remove());
}

export function isExecutableLanguage(lang: string): "python" | "javascript" | null {
  const l = lang.toLowerCase();
  if (l === "python" || l === "py") return "python";
  if (l === "javascript" || l === "js") return "javascript";
  return null;
}

export async function runCode(language: string, code: string): Promise<string> {
  const lang = isExecutableLanguage(language);
  if (lang === "python") return runPython(code);
  if (lang === "javascript") return runJavaScript(code);
  throw new Error(`Language not executable: ${language}`);
}
