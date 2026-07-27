export function splitThinking(text: string): { thinking: string; content: string } {
  if (!text) return { thinking: "", content: "" };
  const parts: string[] = [];
  let remaining = text;
  const closed = /<think>([\s\S]*?)<\/think>/g;
  remaining = remaining.replace(closed, (_m, inner) => {
    parts.push(inner.trim());
    return "";
  });
  const openMatch = remaining.match(/<think>([\s\S]*)$/);
  if (openMatch) {
    parts.push(openMatch[1].trim());
    remaining = remaining.replace(/<think>[\s\S]*$/, "");
  }
  return {
    thinking: parts.filter(Boolean).join("\n\n"),
    content: remaining.trim(),
  };
}
