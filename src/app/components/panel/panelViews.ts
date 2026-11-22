import { BarChart3, FileCode, FolderOpen, ListChecks, ListTodo, Plug, StickyNote, type LucideIcon } from "lucide-react";
import type { PanelView } from "@/lib/chatPanel";

/** Launcher order. ⌥1-8 follow it: 1 is Side chat, then these in turn (Files drops out without host tools). */
export const VIEW_META: Record<PanelView, { label: string; icon: LucideIcon; palette: string }> = {
  files: { label: "Files", icon: FolderOpen, palette: "Open Files" },
  outputs: { label: "Outputs", icon: FileCode, palette: "Open Artifacts" },
  tasks: { label: "Background tasks", icon: ListChecks, palette: "Open Background Tasks" },
  context: { label: "Context", icon: BarChart3, palette: "Context Usage" },
  connectors: { label: "Connectors", icon: Plug, palette: "Open Connectors" },
  notes: { label: "Notes", icon: StickyNote, palette: "Open Scratchpad" },
  todos: { label: "Todos", icon: ListTodo, palette: "Open Todos" },
};

export const VIEW_ORDER: PanelView[] = ["files", "outputs", "tasks", "context", "connectors", "notes", "todos"];

/** The views on offer: Files needs a working folder and host tools. */
export const availableViews = (hasFiles: boolean): PanelView[] => VIEW_ORDER.filter((v) => v !== "files" || hasFiles);
