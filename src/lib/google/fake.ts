// An in-process stand-in for Google, used only in sanity mode (see isSanityMode): the e2e suite never calls Google.
// State lives on globalThis because Next dev can load a module once per route bundle.

export interface FakeGoogle {
  sheets: Map<string, { title: string; values: unknown[][]; raw: boolean }>;
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
    st.sheets.set(id, { title: JSON.parse(String(init.body)).properties.title, values: [], raw: false });
    return json({ spreadsheetId: id });
  }
  const m = u.pathname.match(/^\/v4\/spreadsheets\/([^/]+)\/values\/(.+)$/);
  const sheet = m ? st.sheets.get(decodeURIComponent(m[1])) : undefined;
  if (!m || !sheet) return json({ error: { code: 404 } }, 404);
  if (m[2].endsWith(":clear")) {
    sheet.values = [];
    return json({});
  }
  sheet.values = JSON.parse(String(init.body)).values;
  sheet.raw = u.searchParams.get("valueInputOption") === "RAW";
  return json({ updatedRows: sheet.values.length });
}
