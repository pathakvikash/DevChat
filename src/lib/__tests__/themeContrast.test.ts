import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// WCAG AA (4.5:1) for the status colours Settings > Apps uses, in both themes. Values are read from globals.css.
const css = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

type RGBA = [number, number, number, number];
function parse(v: string): RGBA {
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as RGBA;
  const m = /^rgba?\(([^)]+)\)$/.exec(v)!;
  const [r, g, b, a = 1] = m[1].split(",").map(Number);
  return [r, g, b, a];
}
const over = (top: RGBA, under: RGBA): RGBA => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1) as RGBA;
const lum = ([r, g, b]: RGBA) => {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: RGBA, b: RGBA) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe.each([
  ["dark", ":root", "#09090b"],
  ["light", '[data-theme="light"]', "#fafaf9"],
] as const)("%s theme status colours", (_name, selector, pageHex) => {
  const t = { ...block(":root"), ...block(selector) };
  const page = parse(pageHex);
  const tok = (k: string) => {
    expect(t[k], k).toBeDefined();
    return parse(t[k]);
  };

  it("status text reads on the page and on its own tint", () => {
    for (const k of ["--ok-text", "--warn-text", "--danger-text"]) expect(ratio(tok(k), page), `${k} on page`).toBeGreaterThanOrEqual(4.5);
    expect(ratio(tok("--ok-text"), over(tok("--ok-bg"), page)), "ok badge").toBeGreaterThanOrEqual(4.5);
    expect(ratio(tok("--warn-text"), over(tok("--warn-bg"), page)), "warn badge").toBeGreaterThanOrEqual(4.5);
  });

  it("the Remove button text reads on the danger button's red (the stronger end of its gradient)", () => {
    const red: RGBA = [239, 68, 68, 0.3];
    expect(ratio(tok("--danger-btn-text"), over(red, page))).toBeGreaterThanOrEqual(4.5);
  });
});
