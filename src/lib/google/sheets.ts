import { prisma } from "@/lib/db";
import { deleteSettingsKey, getSettingsKey, setSettingsKey, updateSettingsKey } from "@/lib/settings";
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

/** Google access is missing or was refused: the user must press Connect / Reconnect Google. */
export class ReconnectError extends Error {
  constructor(readonly connected: boolean) {
    super(connected ? "Google access ended. Reconnect Google, then try again." : "Connect Google first.");
  }
}
/** A failure whose message is safe and plain enough to show the user as it is. Anything else becomes a generic message. */
export class SyncError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}
/** The grant came back without the drive.file scope (the box was unticked). */
export class ScopeError extends SyncError {
  constructor() {
    super("Google didn't give DevChat access to the sheets it creates. Try again and keep that box ticked.", 400);
  }
}
const UNREACHABLE = "Couldn't reach Google. Try again.";

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

/** The stored tokens; null when there are none or they can't be read (AUTH_SECRET changed): then the user connects again. */
async function load(userId: string): Promise<Stored | null> {
  try {
    const raw = await getSettingsKey(userId, TOKEN_KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
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

/** Trades the callback's code for tokens and stores them. Throws ScopeError when the file scope was unticked, SyncError when Google refuses. */
export async function exchangeCode(userId: string, code: string, redirectUri: string): Promise<void> {
  const res = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri }).catch(() => null);
  if (!res) throw new SyncError(UNREACHABLE);
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; scope?: string; error?: string };
  if (!res.ok || !body.access_token) {
    // Status and Google's error code only: the body can echo the code or the client.
    console.error("[google] token exchange failed", res.status, typeof body.error === "string" ? body.error : "");
    throw new SyncError("Google didn't accept the sign-in. Try again.");
  }
  if (!(body.scope ?? "").split(" ").includes(SHEETS_SCOPE)) throw new ScopeError();
  const old = await load(userId);
  // Google sends the refresh token only on a first grant; prompt=consent asks for it every time, but keep the old one just in case.
  await save(userId, { accessToken: body.access_token, refreshToken: body.refresh_token ?? old?.refreshToken });
}

/**
 * Deletes the stored tokens, and asks Google to revoke the grant (best effort: the local delete is what matters). Google
 * revokes per OAuth client, which sign-in shares, so the next sign-in may show Google's consent screen again.
 */
export async function disconnect(userId: string): Promise<void> {
  const s = await load(userId);
  await deleteSettingsKey(userId, TOKEN_KEY);
  const token = s?.refreshToken ?? s?.accessToken;
  if (token) await googleFetch(REVOKE_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) }).catch(() => undefined);
}

/**
 * Saves refreshed tokens only if the same grant is still stored: not disconnected, not replaced by a new connection. The
 * access token may differ (a concurrent refresh), so only the refresh token is compared. The write itself is an update
 * that never creates the row, so a Disconnect that lands at any point wins.
 */
async function saveIfCurrent(userId: string, from: Stored, next: Stored): Promise<void> {
  const now = await load(userId);
  if (!now || now.refreshToken !== from.refreshToken) throw new ReconnectError(!!now?.needsReconnect);
  if (!(await updateSettingsKey(userId, TOKEN_KEY, JSON.stringify(next)))) throw new ReconnectError(false);
}

async function refresh(userId: string, s: Stored): Promise<string> {
  const fail = async (): Promise<never> => {
    await saveIfCurrent(userId, s, { needsReconnect: true });
    throw new ReconnectError(true);
  };
  if (!s.refreshToken) return fail();
  const res = await tokenRequest({ grant_type: "refresh_token", refresh_token: s.refreshToken }).catch(() => null);
  if (!res) throw new SyncError(UNREACHABLE);
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  // Only a revoked or expired grant means "reconnect". A 429, invalid_client or a 5xx is a hiccup: keep the tokens.
  if (res.status === 400 && body.error === "invalid_grant") return fail();
  if (!res.ok || !body.access_token) {
    console.error("[google] token refresh failed", res.status, typeof body.error === "string" ? body.error : "");
    throw new SyncError(UNREACHABLE);
  }
  await saveIfCurrent(userId, s, { ...s, accessToken: body.access_token });
  return body.access_token;
}

/** A Google API call as this user. A 401 refreshes the token once and retries; a refused refresh means Reconnect. */
async function call(userId: string, url: string, init: RequestInit = {}): Promise<Response> {
  const s = await load(userId);
  if (!s?.accessToken) throw new ReconnectError(!!s?.needsReconnect);
  const go = (token: string) =>
    googleFetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }).catch(() => {
      throw new SyncError(UNREACHABLE);
    });
  let res = await go(s.accessToken);
  if (res.status === 401) res = await go(await refresh(userId, s));
  // Still refused after a fresh token: access was revoked at Google.
  if (res.status === 401) throw new ReconnectError(true);
  return res;
}

/** Google's limit is 50,000 characters in a cell; longer text is cut, with an ellipsis. */
export const MAX_CELL = 50_000;
export const CHUNK_ROWS = 1000;
export const CHUNK_BYTES = 2_000_000;

/** The table as sheet values: a header row (column labels, then Status), then one row per table row. Every cell is a string of at most MAX_CELL characters. */
export function tableToValues(columns: Column[], rows: { status: string; data: Record<string, unknown> }[]): string[][] {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return s.length > MAX_CELL ? `${s.slice(0, MAX_CELL - 1)}…` : s;
  };
  return [[...columns.map((c) => c.label || c.key), "Status"].map(cell), ...rows.map((r) => [...columns.map((c) => cell(r.data[c.key])), cell(r.status)])];
}

/** Splits rows into writes of at most CHUNK_ROWS rows and about CHUNK_BYTES bytes. `start` is the 1-based sheet row of the chunk's first row. */
export function chunkValues(values: string[][], maxRows = CHUNK_ROWS, maxBytes = CHUNK_BYTES): { start: number; rows: string[][] }[] {
  const out: { start: number; rows: string[][] }[] = [];
  let cur: string[][] = [];
  let bytes = 0;
  let start = 1;
  for (const row of values) {
    const size = Buffer.byteLength(JSON.stringify(row));
    if (cur.length > 0 && (cur.length >= maxRows || bytes + size > maxBytes)) {
      out.push({ start, rows: cur });
      start += cur.length;
      cur = [];
      bytes = 0;
    }
    cur.push(row);
    bytes += size;
  }
  if (cur.length > 0) out.push({ start, rows: cur });
  return out;
}

export const sheetUrlOf = (id: string) => `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit`;

/**
 * Creates a sheet and records it as the table's, but only if the table still has the sheet we saw (`expect`). If another
 * sync got there first, theirs is used. ponytail: the loser's empty sheet stays in Drive; trashing it needs the Drive API.
 */
async function createSheet(userId: string, tableId: string, title: string, expect: string | null): Promise<string> {
  const res = await call(userId, SHEETS_URL, { method: "POST", body: JSON.stringify({ properties: { title } }) });
  const body = (await res.json().catch(() => ({}))) as { spreadsheetId?: string };
  if (!res.ok || !body.spreadsheetId) throw new SyncError("Google couldn't create the sheet. Try again.");
  const claimed = await prisma.dataTable.updateMany({ where: { id: tableId, userId, sheetId: expect }, data: { sheetId: body.spreadsheetId } });
  if (claimed.count === 0) {
    const now = await prisma.dataTable.findFirst({ where: { id: tableId, userId } });
    if (now?.sheetId) return now.sheetId;
  }
  return body.spreadsheetId;
}

interface Tab {
  sheetId: number;
  rows: number;
  cols: number;
}

/** The first tab's id and grid size. A new sheet's grid is 1,000 rows by 26 columns, and a write outside the grid is refused. */
async function firstTab(userId: string, id: string): Promise<Tab | Response> {
  const res = await call(userId, `${SHEETS_URL}/${encodeURIComponent(id)}?fields=sheets.properties(sheetId,gridProperties)`);
  if (!res.ok) return res;
  const p = ((await res.json().catch(() => ({}))) as { sheets?: { properties?: { sheetId?: number; gridProperties?: { rowCount?: number; columnCount?: number } } }[] }).sheets?.[0]?.properties;
  if (typeof p?.sheetId !== "number") throw new SyncError("Google couldn't update the sheet. Try again.");
  return { sheetId: p.sheetId, rows: p.gridProperties?.rowCount ?? 1000, cols: p.gridProperties?.columnCount ?? 26 };
}

async function resizeGrid(userId: string, id: string, tab: Tab, rows: number, cols: number): Promise<Response> {
  return call(userId, `${SHEETS_URL}/${encodeURIComponent(id)}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests: [{ updateSheetProperties: { properties: { sheetId: tab.sheetId, gridProperties: { rowCount: rows, columnCount: cols } }, fields: "gridProperties.rowCount,gridProperties.columnCount" } }] }),
  });
}

/**
 * Puts the rows into sheet `id`. Returns the first refused response, or null when all went through. The grid is grown first
 * (writes outside it are refused), the chunks are written, then the grid is cut to exactly the content, which also deletes
 * the rows and columns an older, bigger table left behind.
 */
async function writeSheet(userId: string, id: string, values: string[][], chunks: { start: number; rows: string[][] }[]): Promise<Response | null> {
  const tab = await firstTab(userId, id);
  if (tab instanceof Response) return tab;
  const rows = Math.max(values.length, 1);
  const cols = Math.max(values[0]?.length ?? 1, 1);
  if (rows > tab.rows || cols > tab.cols) {
    const grown = await resizeGrid(userId, id, tab, Math.max(rows, tab.rows), Math.max(cols, tab.cols));
    if (!grown.ok) return grown;
  }
  for (const c of chunks) {
    const res = await call(userId, `${SHEETS_URL}/${encodeURIComponent(id)}/values/A${c.start}?valueInputOption=RAW`, {
      method: "PUT",
      body: JSON.stringify({ range: `A${c.start}`, majorDimension: "ROWS", values: c.rows }),
    });
    if (!res.ok) return res;
  }
  const grid = await resizeGrid(userId, id, tab, rows, cols);
  return grid.ok ? null : grid;
}

/**
 * Overwrites the table's own sheet with its rows, creating the sheet on the first sync (title = the table's name). The
 * destination is only ever `DataTable.sheetId` for a table this user owns: nothing from a card, a template or the model
 * can name a sheet. RAW keeps Google from reading a cell such as "=HYPERLINK(...)" as a formula.
 *
 * Failure: the rows are written before anything is deleted, so a small table (one write) that fails leaves the old sheet.
 * A table written in several chunks that fails after the first chunk leaves the new rows over the old ones, and the grid
 * not yet cut down; the next sync fixes it. A sheet moved to Drive's Trash is still written by id until the trash is
 * emptied; only a deleted or unreachable one (404, 403) gets replaced.
 */
export async function syncTableToSheet(userId: string, tableId: string): Promise<{ sheetUrl: string; rows: number }> {
  const row = await prisma.dataTable.findFirst({ where: { id: tableId, userId } });
  if (!row) throw new SyncError("Table not found", 404);
  const table = toTableInfo(row);
  const data = await prisma.dataTableRow.findMany({ where: { tableId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const values = tableToValues(table.columns, data.map((r) => ({ status: r.status, data: parseRowData(r.data) })));
  const chunks = chunkValues(values);

  let id = row.sheetId ?? (await createSheet(userId, tableId, table.name, null));
  let failed = await writeSheet(userId, id, values, chunks);
  if (failed && (failed.status === 404 || failed.status === 403) && row.sheetId) {
    // Deleted in Drive, or no longer this account's to write: start a fresh one.
    id = await createSheet(userId, tableId, table.name, row.sheetId);
    failed = await writeSheet(userId, id, values, chunks);
  }
  if (failed) throw new SyncError("Google couldn't update the sheet. Try again.");
  return { sheetUrl: sheetUrlOf(id), rows: data.length };
}
