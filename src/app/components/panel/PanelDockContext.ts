import { createContext } from "react";

/** True inside the chat's docked side panel: a SidePanel then renders in flow (no backdrop, not fixed) and leaves closing to the shell. */
export const PanelDockContext = createContext(false);
