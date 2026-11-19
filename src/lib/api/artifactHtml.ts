const META = `<meta http-equiv="Content-Security-Policy" content="connect-src 'none'; form-action 'none'">`;

/** A model-written page may not make network requests or submit forms. A meta CSP only tightens the page policy. */
export function withNoNetworkCsp(html: string): string {
  // Stays after a doctype: anything before it would put the page in quirks mode.
  const at = /^\s*<!doctype[^>]*>/i.exec(html)?.[0].length ?? 0;
  return html.slice(0, at) + META + html.slice(at);
}
