const MARK = "● ";

function clear() {
  if (document.hidden) return;
  if (document.title.startsWith(MARK)) document.title = document.title.slice(MARK.length);
  document.removeEventListener("visibilitychange", clear);
}

/** Prefixes the tab title with "● " (a reply finished while the tab was hidden); it clears when the tab is shown again. */
export function markTabTitle() {
  if (!document.title.startsWith(MARK)) document.title = MARK + document.title;
  document.addEventListener("visibilitychange", clear);
}
