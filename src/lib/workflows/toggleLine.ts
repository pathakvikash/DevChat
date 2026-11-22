const lines = (text: string) => text.split("\n").map((l) => l.trim());

export const hasLine = (text: string, line: string): boolean => lines(text).includes(line);

/** Adds `line` as a new last line if the text lacks it, else drops that line. Other lines stay as they are. */
export function toggleLine(text: string, line: string): string {
  if (!hasLine(text, line)) return text.trim() === "" ? line : `${text.replace(/\n+$/, "")}\n${line}`;
  return text.split("\n").filter((l) => l.trim() !== line).join("\n");
}
