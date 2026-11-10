// An in-process stand-in for Google, used only in sanity mode (see isSanityMode): the e2e suite never calls Google.
// State lives on globalThis because Next dev can load a module once per route bundle.

/** One spreadsheet. The main tab (sheetId 0, titled `title`) is DevChat's; `extra` are tabs a user added, listed before it. */
export interface FakeSheet {
  title: string;
  values: unknown[][];
  raw: boolean;
  rows: number;
  cols: number;
  frozenRows: number;
  frozenCols: number;
  extra: { sheetId: number; title: string; values: unknown[][] }[];
  mainGone: boolean;
}

export interface FakeGoogle {
  sheets: Map<string, FakeSheet>;
  /** Access tokens this fake still accepts. */
  live: Set<string>;
  failRefresh: boolean;
  seq: number;
}

export function fakeState(): FakeGoogle {
  const g = globalThis as unknown as { __fakeGoogle?: FakeGoogle };
  return (g.__fakeGoogle ??= { sheets: new Map(), live: new Set(), failRefresh: false, seq: 0 });
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export async function fakeGoogle(url: string, init: RequestInit = {}): Promise<Response> {
  const st = fakeState();
  const u = new URL(url);
  if (u.host === "oauth2.googleapis.com" && u.pathname === "/token") {
    const form = new URLSearchParams(String(init.body));
    if (form.get("grant_type") === "refresh_token") {
      if (st.failRefresh) return json({ error: "invalid_grant" }, 400);
      const t = `fake-access-${++st.seq}`;
      st.live.add(t);
      return json({ access_token: t, expires_in: 3600 });
    }
    const t = `fake-access-${++st.seq}`;
    st.live.add(t);
    return json({ access_token: t, refresh_token: "fake-refresh", expires_in: 3600, scope: "openid https://www.googleapis.com/auth/drive.file" });
  }
  if (u.host === "oauth2.googleapis.com" && u.pathname === "/revoke") return json({});
  if (u.host !== "sheets.googleapis.com") return json({ error: "unexpected host" }, 500);

  const token = new Headers(init.headers).get("Authorization")?.replace("Bearer ", "") ?? "";
  if (!st.live.has(token)) return json({ error: { code: 401 } }, 401);
  const method = init.method ?? "GET";
  if (method === "POST" && u.pathname === "/v4/spreadsheets") {
    const id = `fake-sheet-${++st.seq}`;
    st.sheets.set(id, { title: JSON.parse(String(init.body)).properties.title, values: [], raw: false, rows: 1000, cols: 26, frozenRows: 0, frozenCols: 0, extra: [], mainGone: false });
    return json({ spreadsheetId: id });
  }
  const idOf = (m: RegExpMatchArray | null) => decodeURIComponent(m?.[1] ?? "");
  const grid = u.pathname.match(/^\/v4\/spreadsheets\/([^/:]+)$/);
  const update = u.pathname.match(/^\/v4\/spreadsheets\/([^/:]+):batchUpdate$/);
  const whole = u.pathname.match(/^\/v4\/spreadsheets\/([^/]+)\/values\/([^/]+)$/);
  const sheet = st.sheets.get(idOf(grid ?? update ?? whole));
  if (!sheet) return json({ error: { code: 404 } }, 404);
  // Like Google: a new sheet is 1,000 x 26, and a write outside the grid is refused.
  if (grid) {
    const main = { properties: { sheetId: 0, title: "Sheet1", hidden: false, gridProperties: { rowCount: sheet.rows, columnCount: sheet.cols, frozenRowCount: sheet.frozenRows, frozenColumnCount: sheet.frozenCols } } };
    const extra = sheet.extra.map((t) => ({ properties: { sheetId: t.sheetId, title: t.title, hidden: false, gridProperties: { rowCount: 1000, columnCount: 26 } } }));
    return json({ sheets: [...extra, ...(sheet.mainGone ? [] : [main])] });
  }
  if (update) {
    for (const r of JSON.parse(String(init.body)).requests as { updateSheetProperties: { properties: { gridProperties: { rowCount: number; columnCount: number } } } }[]) {
      const g = r.updateSheetProperties.properties.gridProperties;
      if (g.rowCount <= sheet.frozenRows || g.columnCount <= sheet.frozenCols) return json({ error: { code: 400, message: "You can't freeze all visible rows or columns." } }, 400);
      sheet.rows = g.rowCount;
      sheet.cols = g.columnCount;
      sheet.values = sheet.values.slice(0, g.rowCount).map((row) => row.slice(0, g.columnCount));
    }
    return json({});
  }
  if (!whole) return json({ error: { code: 404 } }, 404);
  const rows = JSON.parse(String(init.body)).values as unknown[][];
  // A range names its tab, 'Title'!A1001; an unqualified one would mean the first tab, which is not DevChat's to assume.
  const at = decodeURIComponent(whole[2]).match(/^'((?:[^']|'')*)'!A(\d+)$/);
  if (!at) return json({ error: { code: 400, message: "Unable to parse range" } }, 400);
  const title = at[1].replace(/''/g, "'");
  const target = title === "Sheet1" && !sheet.mainGone ? sheet : sheet.extra.find((t) => t.title === title);
  if (!target) return json({ error: { code: 400, message: `Unable to parse range: ${title}` } }, 400);
  const first = Number(at[2]);
  if (target === sheet && (first + rows.length - 1 > sheet.rows || rows.some((r) => r.length > sheet.cols))) {
    return json({ error: { code: 400, message: `Range (${title}!A${first}) exceeds grid limits. Max rows: ${sheet.rows}, max columns: ${sheet.cols}`, status: "INVALID_ARGUMENT" } }, 400);
  }
  target.values.splice(first - 1, rows.length, ...rows);
  sheet.raw = u.searchParams.get("valueInputOption") === "RAW";
  return json({ updatedRows: rows.length });
}
