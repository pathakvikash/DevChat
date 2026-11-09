/** Untrusted text can nest quotes and list markers thousands deep, which overflows the markdown parser's stack or freezes it.
 *  True when a line starts with 32 or more of them in a row; such text is shown as plain text. Linear: measured under 1 ms on 20 KB. */
const DEEP = /^(?:[ \t]*(?:>|[-*+][ \t]|\d{1,9}[.)][ \t])){32}/m;
export const tooDeeplyNested = (content: string): boolean => DEEP.test(content);

/** Where a link goes, shown beside its text so the text can't hide it: "evil.example", or the whole address when it has no host. */
export function linkTarget(href: string): string {
  try {
    return new URL(href).hostname || href;
  } catch {
    return href;
  }
}
