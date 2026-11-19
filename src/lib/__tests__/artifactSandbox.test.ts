import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import nextConfig from "../../../next.config";

const panel = readFileSync(path.join(__dirname, "../../app/components/ArtifactPanel.tsx"), "utf8");

describe("HTML artifact sandbox", () => {
  it("the artifact route gets its own CSP after the global one, with a sandbox and no network", async () => {
    const entries = await nextConfig.headers!();
    const at = entries.findIndex((e) => e.source === "/api/conversations/:id/artifacts/:artifactId/html");
    expect(at).toBeGreaterThan(entries.findIndex((e) => e.source === "/(.*)"));
    const csp = entries[at].headers.find((h) => h.key === "Content-Security-Policy")!.value;
    expect(csp.startsWith("sandbox allow-scripts")).toBe(true);
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).not.toContain("allow-same-origin");
  });

  it("the preview iframe is sandboxed with allow-scripts only", () => {
    expect([...panel.matchAll(/sandbox="([^"]*)"/g)].map((m) => m[1])).toEqual(["allow-scripts"]);
  });

  it("nothing opens the raw /html URL as a top-level page", () => {
    for (const call of panel.matchAll(/window\.open\([^)]*\)/g)) expect(call[0]).not.toContain("/html");
    expect(panel).not.toMatch(/href=\{htmlUrl\}/);
  });

  it("a model-written SVG is shown as an image, never as markup in the app page", () => {
    const svg = panel.slice(panel.indexOf('artifact.type === "svg"'), panel.indexOf('artifact.type === "data"'));
    expect(svg).toContain("data:image/svg+xml");
    expect(svg).not.toContain("dangerouslySetInnerHTML");
    // The only raw markup left in the panel is highlighter output (escaped) and sanitised mermaid.
    const raw = [...panel.matchAll(/__html: ([^}]+)\}/g)].map((m) => m[1].trim());
    expect(raw).toEqual(['html', 'highlightCode(artifact.content, "html")', "svg", "svg"]);
  });
});
