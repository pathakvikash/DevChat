// Dependency-free React strip: "Part of Orrery · [Open Orrery] [other apps...]". 32px tall, light/dark.
export interface SuiteApp {
  name: string;
  url: string;
}

const css = `
.orrery-strip{box-sizing:border-box;height:32px;display:flex;align-items:center;gap:12px;padding:0 12px;font:12px/1 system-ui,sans-serif;background:#f4f4f5;color:#52525b;border-bottom:1px solid #e4e4e7;overflow:hidden;white-space:nowrap}
.orrery-strip a{color:inherit;text-decoration:none;padding:3px 8px;border-radius:6px;border:1px solid #d4d4d8}
.orrery-strip a:hover{background:#e4e4e7}
@media(prefers-color-scheme:dark){.orrery-strip{background:#18181b;color:#a1a1aa;border-color:#27272a}.orrery-strip a{border-color:#3f3f46}.orrery-strip a:hover{background:#27272a}}`;

export function SuiteStrip({ orreryUrl, apps = [] }: { orreryUrl: string; apps?: SuiteApp[] }) {
  return (
    <div className="orrery-strip" role="navigation" aria-label="Orrery suite">
      <style>{css}</style>
      <span>Part of Orrery &middot;</span>
      <a href={orreryUrl}>Open Orrery</a>
      {apps.map((a) => (
        <a key={a.url} href={a.url}>
          {a.name}
        </a>
      ))}
    </div>
  );
}
