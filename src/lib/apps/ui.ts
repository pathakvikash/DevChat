// Pure helpers for the apps UI (settings page, sidebar launcher).
import type { AppPermission, AppTool } from "./types";

/** The env lines the owner pastes into the app's deployment, shown once after registration. */
export function envSnippet(secret: string): string {
  return `ORRERY_APP_SECRET=${secret}\nORRERY_ISSUER=orrery`;
}

export function groupTools(tools: AppTool[]): { readOnly: AppTool[]; other: AppTool[] } {
  return { readOnly: tools.filter((t) => t.readOnly), other: tools.filter((t) => !t.readOnly) };
}

export function permissionCopy(p: AppPermission): { label: string; detail: string } {
  return p === "actions"
    ? { label: "Can take actions", detail: "Some tools change things in the app (create, order, delete). Orrery asks you before each of those runs." }
    : { label: "Read only", detail: "Every tool only reads data. Nothing is changed in the app." };
}

/** Where the sidebar and palette send the user: the backend turns `home` into the app's base URL. */
export const appHomeHref = (id: string) => `/api/apps/${encodeURIComponent(id)}/go?link=home`;
