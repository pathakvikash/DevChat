/** Labels for side-chat panes: the tab title, a folded tool line, and "19 hours ago". Pure. */

const SUMMARY_KEYS = ["query", "q", "url", "path", "file", "command", "question", "title", "name", "prompt"];

/** The tab chip's text: the side chat's own title, else its first message, else "Side chat". "New Chat" is the placeholder every chat starts with, so it counts as no title. */
export function sideChatTitle(title: string | null | undefined, firstMessage: string | null | undefined): string {
  const own = title?.trim();
  if (own && own !== "New Chat") return own;
  const first = firstMessage?.replace(/\s+/g, " ").trim().slice(0, 80);
  return first || "Side chat";
}

/** "Used Search chats: react hooks", or "Used Search chats" when the input has no obvious summary. */
export function toolLineLabel(toolName: string, input: unknown): string {
  const title = humanize(toolName);
  const summary = toolSummary(input);
  return summary ? `Used ${title}: ${summary}` : `Used ${title}`;
}

/** "just now", "1 minute ago", "19 hours ago", "3 days ago". Empty when the date does not parse. */
export function formatAgo(date: Date | string, now = Date.now()): string {
  const then = new Date(date).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return ago(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return ago(hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 30) return ago(days, "day");
  const months = Math.floor(days / 30);
  if (months < 12) return ago(months, "month");
  return ago(Math.floor(months / 12), "year");
}

function ago(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}

function humanize(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Tool";
}

function toolSummary(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  for (const key of SUMMARY_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      const text = value.replace(/\s+/g, " ").trim();
      return text.length > 60 ? `${text.slice(0, 59)}…` : text;
    }
  }
  return "";
}
