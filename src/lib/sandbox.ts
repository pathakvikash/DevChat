"use client";

let pyodideLoader: Promise<any> | null = null;

function loadPyodide(): Promise<any> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Pyodide only runs in the browser"));
  }
  const w = window as any;
  if (w.__pyodide) return Promise.resolve(w.__pyodide);
  if (pyodideLoader) return pyodideLoader;

  pyodideLoader = new Promise((resolve, reject) => {
    const CDNS = [
      "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/",
      "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/",
    ];
    let cdnIndex = 0;

    const tryNext = () => {
      cdnIndex++;
      if (cdnIndex < CDNS.length) {
        loadFromIndex(cdnIndex);
      } else {
        reject(new Error("Failed to load Pyodide from any CDN"));
      }
    };

    function loadFromIndex(idx: number) {
      if (w.loadPyodide) {
        w.loadPyodide({ indexURL: CDNS[idx] })
          .then((py: any) => {
            w.__pyodide = py;
            resolve(py);
          })
          .catch(tryNext);
        return;
      }
      const script = document.createElement("script");
      script.src = `${CDNS[idx]}pyodide.js`;
      script.onload = () => {
        w.loadPyodide({ indexURL: CDNS[idx] })
          .then((py: any) => {
            w.__pyodide = py;
            resolve(py);
          })
          .catch(tryNext);
      };
      script.onerror = tryNext;
      document.head.appendChild(script);
    }

    loadFromIndex(0);
  });
  return pyodideLoader;
}

async function runPython(code: string): Promise<string> {
  const py = await loadPyodide();
  py.runPython(`
import sys, io
sys.stdout = io.StringIO()
sys.stderr = io.StringIO()
  `);
  let result: any;
  let err: string | null = null;
  try {
    result = await py.runPythonAsync(code);
  } catch (e: any) {
    err = e?.message || String(e);
  }
  const stdout = py.runPython("sys.stdout.getvalue()");
  const stderr = py.runPython("sys.stderr.getvalue()");
  const parts: string[] = [];
  if (stdout) parts.push(stdout);
  if (stderr) parts.push(stderr);
  if (result !== undefined && result !== null && !err) parts.push(String(result));
  if (err) parts.push(`Error: ${err}`);
  return parts.join("").trimEnd() || "(no output)";
}

function runJavaScript(code: string, timeoutMs = 5000): Promise<string> {
  if (code.length > 10000) {
    return Promise.resolve(`Error: code exceeds 10,000 character limit (${code.length} chars).`);
  }
  const sanitized = code.replace(/<\/script/gi, "<\\/script");
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.sandbox.add("allow-scripts");
    iframe.style.display = "none";
    document.body.appendChild(iframe);

    const channel = `vas-sandbox-${Math.random().toString(36).slice(2)}`;
    const html = `<!doctype html><html><body><script>
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
    <\/script></body></html>`;

    const timer = setTimeout(() => {
      window.removeEventListener("message", handler);
      iframe.remove();
      resolve(`Error: execution timed out (${timeoutMs}ms)`);
    }, timeoutMs);

    function handler(e: MessageEvent) {
      if (e.data?.channel !== channel) return;
      clearTimeout(timer);
      window.removeEventListener("message", handler);
      iframe.remove();
      resolve(e.data.output || "(no output)");
    }
    window.addEventListener("message", handler);
    iframe.srcdoc = html;
  });
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
