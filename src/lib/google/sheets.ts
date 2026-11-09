import { prisma } from "@/lib/db";
import { deleteSettingsKey, getSettingsKey, setSettingsKey } from "@/lib/settings";
import { isSanityMode } from "@/lib/sanityMode";
import { parseRowData, toTableInfo, type Column } from "@/lib/workflows/tables";

// Google Sheets sync (workflows phase 7). Own two-route OAuth instead of the NextAuth adapter, so the tokens go through
// setSettingsKey (AES-GCM) and a later sign-in cannot clobber them. Scope drive.file: DevChat sees only sheets it created.

export const SHEETS_SCOPE = "https://www.googleapis.com/auth/drive.file";
const TOKEN_KEY = "googleSheetsTokens";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const SHEETS_URL = "https://sheets.googleapis.com/v4/spreadsheets";

export const STATE_COOKIE = "devchat_google_state";
export const COOKIE_PATH = "/api/integrations/google";

/** Only a path on this site: never a full URL, so the callback cannot be used to bounce someone elsewhere. */
export const safeReturn = (p: string | null | undefined): string => (p && /^\/(?![/\\])[^\s\\]*$/.test(p) ? p : "/settings");

/** This site's address as the browser sees it. Behind a proxy or on Vercel that is the forwarded headers; in dev, `nextUrl.origin` can say localhost for a 127.0.0.1 page, which would drop the cookies. */
export function siteOf(req: { headers: Headers; nextUrl: { protocol: string; host: string } }): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const proto = (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol).replace(/:$/, "").split(",")[0];
  return `${proto}://${host}`;
}

/** Google access is missing or was refused: the user must press Connect / Reconnect Google. */
export class ReconnectError extends Error {
  constructor(readonly connected: boolean) {
    super(connected ? "Google access ended. Reconnect Google, then try again." : "Connect Google first.");
  }
}

interface Stored {
  accessToken?: string;
  refreshToken?: string;
  /** Set when a refresh was refused: tokens are dropped and the UI says Reconnect. */
  needsReconnect?: boolean;
}

/** All Google traffic goes through here, so the sanity suite can swap in an in-process fake (no real Google call, ever). */
export async function googleFetch(url: string, init?: RequestInit): Promise<Response> {
  if (isSanityMode()) return (await import("./fake")).fakeGoogle(url, init);
  return fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(30_000) });
}

export const googleConfigured = () => !!process.env.GOOGLE_OAUTH_CLIENT_ID && !!process.env.GOOGLE_OAUTH_CLIENT_SECRET;

async function load(userId: string): Promise<Stored | null> {
  const raw = await getSettingsKey(userId, TOKEN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Stored;
  } catch {
    return null;
  }
}
const save = (userId: string, s: Stored) => setSettingsKey(userId, TOKEN_KEY, JSON.stringify(s));

export async function connectionState(userId: string): Promise<{ configured: boolean; connected: boolean; reconnect: boolean }> {
  const s = await load(userId);
  return { configured: googleConfigured(), connected: !!s?.accessToken, reconnect: !!s?.needsReconnect };
}

export function authorizeUrl(redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SHEETS_SCOPE,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${p}`;
}

async function tokenRequest(params: Record<string, string>): Promise<Response> {
  return googleFetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "", ...params }),
  });
}

/** Trades the callback's code for tokens and stores them. Throws a plain message when Google refuses or the scope was unticked. */
export async function exchangeCode(userId: string, code: string, redirectUri: string): Promise<void> {
  const res = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; scope?: string };
  if (!res.ok || !body.access_token) throw new Error("Google didn't accept the sign-in. Try again.");
  if (!(body.scope ?? "").split(" ").includes(SHEETS_SCOPE)) throw new Error("Google didn't give DevChat access to the sheets it creates. Try again and keep that box ticked.");
  const old = await load(userId);
  // Google sends the refresh token only on a first grant; prompt=consent asks for it every time, but keep the old one just in case.
  await save(userId, { accessToken: body.access_token, refreshToken: body.refresh_token ?? old?.refreshToken });
}

/** Deletes the stored tokens, and asks Google to revoke them (best effort: the local delete is what matters). */
export async function disconnect(userId: string): Promise<void> {
  const s = await load(userId);
  await deleteSettingsKey(userId, TOKEN_KEY);
  const token = s?.refreshToken ?? s?.accessToken;
  if (token) await googleFetch(REVOKE_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) }).catch(() => undefined);
}

async function refresh(userId: string, s: Stored): Promise<string> {
  const fail = async (): Promise<never> => {
    await save(userId, { needsReconnect: true });
    throw new ReconnectError(true);
  };
  if (!s.refreshToken) return fail();
  const res = await tokenRequest({ grant_type: "refresh_token", refresh_token: s.refreshToken }).catch(() => null);
  // A network blip is not a refusal: only Google's own 4xx drops the tokens.
  if (!res) throw new Error("Couldn't reach Google. Try again.");
  const body = (await res.json().catch(() => ({}))) as { access_token?: string };
  if (res.status >= 400 && res.status < 500) return fail();
  if (!res.ok || !body.access_token) throw new Error("Couldn't reach Google. Try again.");
  await save(userId, { ...s, accessToken: body.access_token });
  return body.access_token;
}

/** A Google API call as this user. A 401 refreshes the token once and retries; a refused refresh means Reconnect. */
async function call(userId: string, url: string, init: RequestInit = {}): Promise<Response> {
  const s = await load(userId);
  if (!s?.accessToken) throw new ReconnectError(!!s?.needsReconnect);
  const go = (token: string) => googleFetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  let res = await go(s.accessToken);
  if (res.status === 401) res = await go(await refresh(userId, s));
  // Still refused after a fresh token: access was revoked at Google.
  if (res.status === 401) throw new ReconnectError(true);
  return res;
}

/** The table as sheet values: a header row (column labels, then Status), then one row per table row. Every cell is a string. */
export function tableToValues(columns: Column[], rows: { status: string; data: Record<string, unknown> }[]): string[][] {
  const cell = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return [[...columns.map((c) => c.label || c.key), "Status"], ...rows.map((r) => [...columns.map((c) => cell(r.data[c.key])), r.status])];
}

export const sheetUrlOf = (id: string) => `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit`;

async function createSheet(userId: string, tableId: string, title: string): Promise<string> {
  const res = await call(userId, SHEETS_URL, { method: "POST", body: JSON.stringify({ properties: { title } }) });
  const body = (await res.json().catch(() => ({}))) as { spreadsheetId?: string };
  if (!res.ok || !body.spreadsheetId) throw new Error("Google couldn't create the sheet. Try again.");
  await prisma.dataTable.updateMany({ where: { id: tableId, userId }, data: { sheetId: body.spreadsheetId } });
  return body.spreadsheetId;
}

/**
 * Overwrites the table's own sheet with its rows, creating the sheet on the first sync (title = the table's name). The
 * destination is only ever `DataTable.sheetId` for a table this user owns: nothing from a card, a template or the model
 * can name a sheet. RAW keeps Google from reading a cell such as "=HYPERLINK(...)" as a formula.
 */
export async function syncTableToSheet(userId: string, tableId: string): Promise<{ sheetUrl: string; rows: number }> {
  const row = await prisma.dataTable.findFirst({ where: { id: tableId, userId } });
  if (!row) throw new Error("Table not found");
  const table = toTableInfo(row);
  const data = await prisma.dataTableRow.findMany({ where: { tableId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const values = tableToValues(table.columns, data.map((r) => ({ status: r.status, data: parseRowData(r.data) })));

  let id = row.sheetId ?? (await createSheet(userId, tableId, table.name));
  let cleared = await call(userId, `${SHEETS_URL}/${encodeURIComponent(id)}/values/A:ZZ:clear`, { method: "POST", body: "{}" });
  if (cleared.status === 404 && row.sheetId) {
    // The user deleted the sheet in Drive: start a fresh one.
    id = await createSheet(userId, tableId, table.name);
    cleared = await call(userId, `${SHEETS_URL}/${encodeURIComponent(id)}/values/A:ZZ:clear`, { method: "POST", body: "{}" });
  }
  if (!cleared.ok) throw new Error("Google couldn't update the sheet. Try again.");
  const put = await call(userId, `${SHEETS_URL}/${encodeURIComponent(id)}/values/A1?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ range: "A1", majorDimension: "ROWS", values }) });
  if (!put.ok) throw new Error("Google couldn't update the sheet. Try again.");
  return { sheetUrl: sheetUrlOf(id), rows: data.length };
}
