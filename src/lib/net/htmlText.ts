// Every pattern stops at the next opening tag, so unclosed markup stays linear.
/** Readable text from an HTML page: scripts, styles, comments and tags dropped, a few entities decoded, spaces collapsed. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script\b(?:(?!<script\b)[\s\S])*?<\/script>/gi, "")
    .replace(/<style\b(?:(?!<style\b)[\s\S])*?<\/style>/gi, "")
    .replace(/<!--(?:(?!<!--)[\s\S])*?-->/g, "")
    .replace(/<[^<>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** A fetched body as readable text: HTML and XML lose their markup; anything else (plain text, markdown, source code with <Tags> and generics) is returned as it is. */
export const readableText = (body: string, contentType: string): string => (/html|xml/i.test(contentType) ? htmlToText(body) : body);
