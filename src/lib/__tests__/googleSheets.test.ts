import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// In-memory settings and table: just the calls the Sheets code makes. fetch is mocked, so no real Google call can happen.
const settings = new Map<string, string>();
let table: any;
let dataRows: any[] = [];
vi.mock("@/lib/settings", () => ({
  getSettingsKey: vi.fn(async (_u: string, k: string) => settings.get(k) ?? null),
  setSettingsKey: vi.fn(async (_u: string, k: string, v: string) => void settings.set(k, v)),
  deleteSettingsKey: vi.fn(async (_u: string, k: string) => void settings.delete(k)),
  // like the real one: never creates a row
  updateSettingsKey: vi.fn(async (_u: string, k: string, v: string) => (settings.has(k) ? (settings.set(k, v), true) : false)),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    dataTable: {
      findFirst: vi.fn(async ({ where }: any) => (table && table.id === where.id && table.userId === where.userId ? table : null)),
      updateMany: vi.fn(async ({ where, data }: any) => (table?.id === where.id && table.userId === where.userId && (where.sheetId === undefined || table.sheetId === where.sheetId) ? (Object.assign(table, data), { count: 1 }) : { count: 0 })),
    },
    dataTableRow: { findMany: vi.fn(async () => dataRows) },
  },
}));
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn(async () => "u1"), UnauthorizedError: class extends Error {} }));
const mode = vi.hoisted(() => ({ sanity: false }));
vi.mock("@/lib/sanityMode", () => ({ isSanityMode: () => mode.sanity }));

import { appOrigin } from "@/lib/appOrigin";
import { chunkValues, authorizeUrl, connectionState, disconnect, exchangeCode, syncTableToSheet, tableToValues, ReconnectError, SHEETS_SCOPE } from "@/lib/google/sheets";
import { GET as callback } from "@/app/api/integrations/google/callback/route";
import { GET as connect } from "@/app/api/integrations/google/connect/route";
import { sheetSyncCard } from "@/lib/workflows/cards/sheetSync";
import { reachesOpenWeb, reachesWeb, CATALOG, ADDABLE_TYPES } from "@/lib/workflows/catalog";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const stored = () => JSON.parse(settings.get("googleSheetsTokens") ?? "null");
const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), method: init?.method ?? "GET", body: init?.body, auth: (init?.headers as Record<string, string> | undefined)?.Authorization }));

/** A scripted Google: tokens, create, clear and update. `expired` access tokens get a 401. */
function google(opts: { refreshStatus?: number; refreshError?: string; deleted?: boolean; forbidden?: boolean; failPutAt?: number } = {}) {
  let puts = 0;
  let n = 0;
  const live = new Set<string>(["good"]);
  fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
    const u = new URL(String(url));
    if (u.host === "oauth2.googleapis.com" && u.pathname === "/token") {
      const form = new URLSearchParams(String(init.body));
      if (form.get("grant_type") === "refresh_token") {
        if (opts.refreshStatus && opts.refreshStatus >= 400) return json({ error: opts.refreshError ?? "invalid_grant" }, opts.refreshStatus);
        live.add("fresh");
        return json({ access_token: "fresh" });
      }
      return json({ access_token: "good", refresh_token: "r1", scope: `openid ${SHEETS_SCOPE}` });
    }
    if (u.host === "oauth2.googleapis.com") return json({});
    const token = new Headers(init.headers).get("Authorization")?.replace("Bearer ", "") ?? "";
    if (!live.has(token)) return json({}, 401);
    if (init.method === "POST" && u.pathname === "/v4/spreadsheets") return json({ spreadsheetId: `sheet${++n}` });
    if ((opts.deleted || opts.forbidden) && u.pathname.includes("/sheetgone")) return json({}, opts.deleted ? 404 : 403);
    if (!init.method && /^\/v4\/spreadsheets\/[^/]+$/.test(u.pathname)) return json({ sheets: [{ properties: { sheetId: 0, gridProperties: { rowCount: 1000, columnCount: 26 } } }] });
    if (init.method === "PUT" && ++puts === opts.failPutAt) return json({ error: { code: 400 } }, 400);
    return json({});
  });
}

beforeEach(() => {
  settings.clear();
  fetchMock.mockReset();
  table = { id: "t1", userId: "u1", name: "Jobs", columns: JSON.stringify([{ key: "title", label: "Title", type: "text" }, { key: "url", label: "URL", type: "url" }]), statuses: '["new"]', sheetId: null };
  dataRows = [{ id: "r1", status: "new", data: JSON.stringify({ title: "=HYPERLINK(\"http://evil\",\"x\")", url: "https://a.test" }) }];
  process.env.GOOGLE_OAUTH_CLIENT_ID = "cid";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
});

const req = (path: string, cookie?: string) => new NextRequest(`http://localhost:3000${path}`, cookie ? { headers: { cookie } } : undefined);

describe("connect and callback", () => {
  it("connect asks for drive.file only, offline, incremental, with a state cookie scoped to the integration routes", async () => {
    const res = await connect(req("/api/integrations/google/connect?returnTo=/tables/t1%3Fsync%3D1"));
    const to = new URL(res.headers.get("location")!);
    expect(to.host).toBe("accounts.google.com");
    expect(to.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive.file");
    expect(to.searchParams.get("access_type")).toBe("offline");
    expect(to.searchParams.get("include_granted_scopes")).toBe("true");
    expect(to.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/integrations/google/callback");
    const cookie = decodeURIComponent(res.headers.get("set-cookie")!);
    expect(cookie).toContain(`${to.searchParams.get("state")}|/tables/t1?sync=1`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Max-Age=\d+/i);
    expect(cookie).toContain("Path=/api/integrations/google");
  });

  it("connect never sends the user to another site afterwards", async () => {
    for (const bad of ["https://evil.test", "//evil.test", "/\\evil.test"]) {
      const res = await connect(req(`/api/integrations/google/connect?returnTo=${encodeURIComponent(bad)}`));
      expect(decodeURIComponent(res.headers.get("set-cookie")!)).toContain("|/settings");
    }
  });

  it("the callback rejects a missing or wrong state, and exchanges and stores nothing", async () => {
    google();
    for (const r of [
      req("/api/integrations/google/callback?code=c&state=abc"), // no cookie
      req("/api/integrations/google/callback?code=c", "devchat_google_state=abc|/settings"), // no state in the URL
      req("/api/integrations/google/callback?code=c&state=zzz", "devchat_google_state=abc|/settings"), // different
    ]) {
      const res = await callback(r);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("http://localhost:3000/settings?google=failed");
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(settings.size).toBe(0);
  });

  it("a good state exchanges the code, stores the tokens and goes back where the user started", async () => {
    google();
    const res = await callback(req("/api/integrations/google/callback?code=c&state=abc", "devchat_google_state=abc|/tables/t1?sync=1"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/tables/t1?sync=1&google=connected");
    expect(stored()).toEqual({ accessToken: "good", refreshToken: "r1" });
    expect(res.headers.get("set-cookie")).toMatch(/devchat_google_state=;|Max-Age=0|Expires=/i);
    // the tokens are not in any cookie
    expect(res.headers.get("set-cookie")).not.toContain("good");
  });

  it("a denied consent, or a grant without the file scope, stores nothing", async () => {
    google();
    const denied = await callback(req("/api/integrations/google/callback?error=access_denied&state=abc", "devchat_google_state=abc|/settings"));
    expect(denied.headers.get("location")).toContain("google=denied");
    fetchMock.mockImplementationOnce(async () => json({ access_token: "x", scope: "openid email" }));
    const narrow = await callback(req("/api/integrations/google/callback?code=c&state=abc", "devchat_google_state=abc|/settings"));
    expect(narrow.headers.get("location")).toContain("google=scope");
    // a multibyte state of the same character length is refused, not a crash
    const wide = await callback(req("/api/integrations/google/callback?code=c&state=%C3%A9bc", "devchat_google_state=abc|/settings"));
    expect(wide.headers.get("location")).toContain("google=failed");
    expect(settings.size).toBe(0);
  });

  it("authorizeUrl and the token call use the configured client", async () => {
    expect(authorizeUrl("http://x/cb", "s").includes("client_id=cid")).toBe(true);
    google();
    await exchangeCode("u1", "c", "http://x/cb");
    expect(String(fetchMock.mock.calls[0][1].body)).toContain("client_secret=secret");
  });
});

describe("rows to values", () => {
  it("a header row of labels plus Status, every cell a string", () => {
    const v = tableToValues([{ key: "n", label: "N", type: "number" }, { key: "o", label: "", type: "text" }], [{ status: "new", data: { n: 5, o: { a: 1 } } }, { status: "x", data: {} }]);
    expect(v).toEqual([["N", "o", "Status"], ["5", '{"a":1}', "new"], ["", "", "x"]]);
  });

  it("a cell that starts with = goes out as a string, with valueInputOption=RAW", async () => {
    google();
    await exchangeCode("u1", "c", "http://x/cb");
    fetchMock.mockClear();
    await syncTableToSheet("u1", "t1");
    const update = calls().find((c) => c.method === "PUT")!;
    expect(update.url).toContain("valueInputOption=RAW");
    expect(update.url).not.toContain("USER_ENTERED");
    const sent = JSON.parse(String(update.body));
    expect(sent.values[1][0]).toBe('=HYPERLINK("http://evil","x")');
    expect(typeof sent.values[1][0]).toBe("string");
  });
});

describe("size limits and write order", () => {
  it("a cell over 50,000 characters is cut to 49,999 plus an ellipsis", () => {
    const v = tableToValues([{ key: "a", label: "A", type: "longtext" }], [{ status: "new", data: { a: "x".repeat(60_000) } }]);
    expect(v[1][0]).toHaveLength(50_000);
    expect(v[1][0].endsWith("x…")).toBe(true);
    expect(tableToValues([{ key: "a", label: "A", type: "text" }], [{ status: "s", data: { a: "y".repeat(50_000) } }])[1][0]).toHaveLength(50_000);
  });

  it("rows go in chunks of at most 1,000 rows or the byte cap, each at its own row", () => {
    const rows = Array.from({ length: 2500 }, (_, i) => [String(i)]);
    const c = chunkValues(rows);
    expect(c.map((x) => [x.start, x.rows.length])).toEqual([[1, 1000], [1001, 1000], [2001, 500]]);
    const big = chunkValues([["a".repeat(600)], ["b".repeat(600)], ["c".repeat(600)]], 1000, 1500);
    expect(big.map((x) => [x.start, x.rows.length])).toEqual([[1, 2], [3, 1]]);
    expect(chunkValues([["only"]])).toEqual([{ start: 1, rows: [["only"]] }]);
  });

  it("a big table: the grid is grown first, rows go in chunks, then the grid is cut to the content; a failed chunk never shrinks it", async () => {
    google();
    await exchangeCode("u1", "c", "http://x/cb");
    dataRows = Array.from({ length: 1500 }, (_, i) => ({ id: `r${i}`, status: "new", data: JSON.stringify({ title: `t${i}`, url: "u" }) }));
    fetchMock.mockClear();
    await syncTableToSheet("u1", "t1");
    const seq = calls().map((c) => `${c.method} ${new URL(c.url).pathname.replace("/v4/spreadsheets", "").replace("/values", "")}`);
    expect(seq).toEqual(["POST ", "GET /sheet1", "POST /sheet1:batchUpdate", "PUT /sheet1/A1", "PUT /sheet1/A1001", "POST /sheet1:batchUpdate"]);
    const grow = JSON.parse(String(calls()[2].body)).requests[0].updateSheetProperties.properties.gridProperties;
    expect(grow).toEqual({ rowCount: 1501, columnCount: 26 });

    google({ failPutAt: 2 });
    await exchangeCode("u1", "c", "http://x/cb");
    fetchMock.mockClear();
    await expect(syncTableToSheet("u1", "t1")).rejects.toThrow("Google couldn't update the sheet. Try again.");
    // grown before the writes, never cut down after the failed one
    expect(calls().filter((c) => c.url.includes("batchUpdate"))).toHaveLength(1);
  });

  it("1,500 rows by 30 columns against a grid-checking Google: the grid grows, every row lands, and the grid ends exactly the size of the table", async () => {
    mode.sanity = true;
    try {
      const { fakeState, fakeGoogle } = await import("@/lib/google/fake");
      fakeState().sheets.clear();
      fakeState().live.clear();
      table.columns = JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ key: `c${i}`, label: `C${i}`, type: "text" })));
      table.sheetId = null;
      dataRows = Array.from({ length: 1500 }, (_, i) => ({ id: `r${i}`, status: "new", data: JSON.stringify({ c0: `row${i}`, c29: "end" }) }));
      await exchangeCode("u1", "c", "http://x/cb");
      await syncTableToSheet("u1", "t1");
      const sheet = [...fakeState().sheets.values()][0];
      expect(sheet.values).toHaveLength(1501);
      expect(sheet.values[1500][0]).toBe("row1499");
      expect([sheet.rows, sheet.cols]).toEqual([1501, 31]);
      // the same Google refuses a write outside the grid, the way the real one does
      const [id] = [...fakeState().sheets.keys()];
      const token = [...fakeState().live][0];
      const bad = await fakeGoogle(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/A2000?valueInputOption=RAW`, { method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ values: [["x"]] }) });
      expect(bad.status).toBe(400);
      expect(JSON.stringify(await bad.json())).toContain("exceeds grid limits");
      // a smaller table cuts the grid down: no leftover rows or columns
      table.columns = JSON.stringify([{ key: "c0", label: "C0", type: "text" }]);
      dataRows = dataRows.slice(0, 2);
      await syncTableToSheet("u1", "t1");
      expect(sheet.values).toEqual([["C0", "Status"], ["row0", "new"], ["row1", "new"]]);
      expect([sheet.rows, sheet.cols]).toEqual([3, 2]);
    } finally {
      mode.sanity = false;
    }
  });

  it("a network failure is a plain message", async () => {
    google();
    await exchangeCode("u1", "c", "http://x/cb");
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed: ECONNRESET 10.0.0.1"));
    await expect(syncTableToSheet("u1", "t1")).rejects.toMatchObject({ message: "Couldn't reach Google. Try again." });
  });
});

describe("sync", () => {
  it("the first sync creates the sheet named after the table and saves its id; the next one clears and overwrites it", async () => {
    google();
    await exchangeCode("u1", "c", "http://x/cb");
    fetchMock.mockClear();
    const first = await syncTableToSheet("u1", "t1");
    expect(first).toEqual({ sheetUrl: "https://docs.google.com/spreadsheets/d/sheet1/edit", rows: 1 });
    expect(table.sheetId).toBe("sheet1");
    expect(calls().map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(["POST /v4/spreadsheets", "GET /v4/spreadsheets/sheet1", "PUT /v4/spreadsheets/sheet1/values/A1", "POST /v4/spreadsheets/sheet1:batchUpdate"]);
    expect(JSON.parse(String(calls()[0].body))).toEqual({ properties: { title: "Jobs" } });

    fetchMock.mockClear();
    dataRows.push({ id: "r2", status: "new", data: JSON.stringify({ title: "Two", url: "https://b.test" }) });
    const second = await syncTableToSheet("u1", "t1");
    expect(second.rows).toBe(2);
    expect(calls().map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(["GET /v4/spreadsheets/sheet1", "PUT /v4/spreadsheets/sheet1/values/A1", "POST /v4/spreadsheets/sheet1:batchUpdate"]);
    expect(JSON.parse(String(calls()[1].body)).values).toHaveLength(3);
    // after the write the grid is cut to exactly the content: 3 rows by 3 columns
    expect(JSON.parse(String(calls()[2].body)).requests[0].updateSheetProperties.properties.gridProperties).toEqual({ rowCount: 3, columnCount: 3 });
  });

  it("the destination is the table's own sheetId and nothing else: a table that is not the user's cannot be synced", async () => {
    google();
    await exchangeCode("u1", "c", "http://x/cb");
    await expect(syncTableToSheet("someone-else", "t1")).rejects.toThrow("Table not found");
    await expect(syncTableToSheet("u1", "nope")).rejects.toThrow("Table not found");
    // the card has no setting that can name a sheet: only tableId survives its schema
    expect(CATALOG.sheetSync.schema.parse({ tableId: "t1", sheetId: "x", sheetUrl: "https://x", range: "A1" })).toEqual({ tableId: "t1" });
    expect(CATALOG.sheetSync.fields.map((f) => f.key)).toEqual(["tableId"]);
    expect(CATALOG.sheetSync.fields[0].kind).toBe("table");
  });

  it("a sheet deleted in Drive is replaced by a new one", async () => {
    google({ deleted: true });
    await exchangeCode("u1", "c", "http://x/cb");
    table.sheetId = "sheetgone";
    const r = await syncTableToSheet("u1", "t1");
    expect(r.sheetUrl).toBe("https://docs.google.com/spreadsheets/d/sheet1/edit");
    expect(table.sheetId).toBe("sheet1");
  });

  it("a sheet this account can't reach (403) is replaced like a deleted one", async () => {
    google({ forbidden: true });
    await exchangeCode("u1", "c", "http://x/cb");
    table.sheetId = "sheetgone";
    expect((await syncTableToSheet("u1", "t1")).sheetUrl).toContain("sheet1");
    expect(table.sheetId).toBe("sheet1");
  });

  it("two syncs creating the first sheet at once: the one that lost uses the winner's sheet", async () => {
    google();
    await exchangeCode("u1", "c", "http://x/cb");
    const { prisma } = await import("@/lib/db");
    // the other sync records its sheet while ours is being created
    vi.mocked(prisma.dataTable.updateMany).mockImplementationOnce((async () => ((table.sheetId = "winner"), { count: 0 })) as never);
    const r = await syncTableToSheet("u1", "t1");
    expect(r.sheetUrl).toContain("/winner/");
    expect(table.sheetId).toBe("winner");
  });

  it("without a connection it asks for Connect, and it never calls Google", async () => {
    google();
    await expect(syncTableToSheet("u1", "t1")).rejects.toMatchObject({ connected: false, message: "Connect Google first." });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("token refresh", () => {
  it("a 401 refreshes with the refresh token, stores the new access token and retries once", async () => {
    google();
    settings.set("googleSheetsTokens", JSON.stringify({ accessToken: "stale", refreshToken: "r1" }));
    const r = await syncTableToSheet("u1", "t1");
    expect(r.rows).toBe(1);
    const auths = calls().map((c) => c.auth).filter(Boolean);
    expect(auths[0]).toBe("Bearer stale");
    expect(auths.slice(1).every((a) => a === "Bearer fresh")).toBe(true);
    expect(calls().filter((c) => c.url.includes("/token"))).toHaveLength(1);
    expect(stored()).toEqual({ accessToken: "fresh", refreshToken: "r1" });
  });

  it("a refused refresh drops the tokens and says Reconnect, not a raw error", async () => {
    google({ refreshStatus: 400 });
    settings.set("googleSheetsTokens", JSON.stringify({ accessToken: "stale", refreshToken: "r1" }));
    const err = await syncTableToSheet("u1", "t1").catch((e) => e);
    expect(err).toBeInstanceOf(ReconnectError);
    expect(err.message).toBe("Google access ended. Reconnect Google, then try again.");
    expect(stored()).toEqual({ needsReconnect: true });
    expect(await connectionState("u1")).toEqual({ configured: true, connected: false, reconnect: true });
    // and the card turns it into a plain instruction
    await expect(sheetSyncCard.run({ userId: "u1", config: { tableId: "t1" } } as never)).rejects.toThrow("Open Settings, choose Reconnect Google");
  });

  it("only invalid_grant means Reconnect: a 429, invalid_client or 500 keeps the tokens and says to try again", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const [status, error] of [[429, "rate_limit"], [401, "invalid_client"], [400, "invalid_request"], [500, ""]] as const) {
      google({ refreshStatus: status, refreshError: error });
      settings.set("googleSheetsTokens", JSON.stringify({ accessToken: "stale", refreshToken: "r1" }));
      const err = await syncTableToSheet("u1", "t1").catch((e) => e);
      expect(err).not.toBeInstanceOf(ReconnectError);
      expect(err.message).toBe("Couldn't reach Google. Try again.");
      expect(stored()).toEqual({ accessToken: "stale", refreshToken: "r1" });
    }
    spy.mockRestore();
  });

  it("a refresh that races Disconnect does not bring the tokens back", async () => {
    google();
    settings.set("googleSheetsTokens", JSON.stringify({ accessToken: "stale", refreshToken: "r1" }));
    fetchMock.mockImplementationOnce(async () => json({}, 401)); // the first call is refused ...
    fetchMock.mockImplementationOnce(async () => {
      settings.delete("googleSheetsTokens"); // ... and the user disconnects while the refresh is in flight
      return json({ access_token: "fresh" });
    });
    await expect(syncTableToSheet("u1", "t1")).rejects.toBeInstanceOf(ReconnectError);
    expect(settings.size).toBe(0);
  });

  it("two syncs with an expired token both succeed (a concurrent refresh is not a different grant)", async () => {
    google();
    settings.set("googleSheetsTokens", JSON.stringify({ accessToken: "stale", refreshToken: "r1" }));
    table.sheetId = "sheet0";
    const both = await Promise.allSettled([syncTableToSheet("u1", "t1"), syncTableToSheet("u1", "t1")]);
    expect(both.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(stored().refreshToken).toBe("r1");
  });

  it("Disconnect wins in either order: before the refresh saves, or after it", async () => {
    google();
    // before: the row disappears between saveIfCurrent's read and its write, and nothing is created
    settings.set("googleSheetsTokens", JSON.stringify({ accessToken: "stale", refreshToken: "r1" }));
    const { updateSettingsKey } = await import("@/lib/settings");
    vi.mocked(updateSettingsKey).mockImplementationOnce(async (_u, k) => (settings.delete(k), false));
    table.sheetId = "sheet0";
    await expect(syncTableToSheet("u1", "t1")).rejects.toBeInstanceOf(ReconnectError);
    expect(settings.size).toBe(0);
    // after: a disconnect once the tokens are saved leaves them gone
    google();
    settings.set("googleSheetsTokens", JSON.stringify({ accessToken: "stale", refreshToken: "r1" }));
    await syncTableToSheet("u1", "t1");
    await disconnect("u1");
    expect(settings.size).toBe(0);
  });

  it("tokens that can't be decrypted count as not connected, not as a crash", async () => {
    const { getSettingsKey } = await import("@/lib/settings");
    vi.mocked(getSettingsKey).mockRejectedValueOnce(new Error("Unsupported state or unable to authenticate data"));
    expect(await connectionState("u1")).toEqual({ configured: true, connected: false, reconnect: false });
  });

  it("no refresh token means Reconnect without a call to Google's token endpoint", async () => {
    google();
    settings.set("googleSheetsTokens", JSON.stringify({ accessToken: "stale" }));
    await expect(syncTableToSheet("u1", "t1")).rejects.toBeInstanceOf(ReconnectError);
    expect(calls().some((c) => c.url.includes("/token"))).toBe(false);
  });

  it("a network error while refreshing is a plain retry message and keeps the tokens", async () => {
    settings.set("googleSheetsTokens", JSON.stringify({ accessToken: "stale", refreshToken: "r1" }));
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/token")) throw new TypeError("fetch failed");
      return json({}, 401);
    });
    await expect(syncTableToSheet("u1", "t1")).rejects.toThrow("Couldn't reach Google. Try again.");
    expect(stored().refreshToken).toBe("r1");
  });
});

describe("disconnect and privacy of the card", () => {
  it("disconnect deletes the stored tokens and revokes at Google, best effort", async () => {
    google();
    await exchangeCode("u1", "c", "http://x/cb");
    fetchMock.mockClear();
    await disconnect("u1");
    expect(settings.size).toBe(0);
    expect(calls()[0].url).toBe("https://oauth2.googleapis.com/revoke");
    // a failing revoke still leaves the user disconnected
    await exchangeCode("u1", "c", "http://x/cb");
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await disconnect("u1");
    expect(settings.size).toBe(0);
  });

  it("sheetSync is not a web card: it does not count as reaching the web", () => {
    expect(reachesWeb("sheetSync", { tableId: "t1" })).toBe(false);
    expect(reachesOpenWeb("sheetSync", { tableId: "t1" })).toBe(false);
    expect(ADDABLE_TYPES.at(-1)).toBe("sheetSync");
  });
});

describe("appOrigin", () => {
  const h = (o: Record<string, string>, nextUrl?: { protocol: string }) => ({ headers: new Headers(o), nextUrl });
  it("AUTH_URL wins, then the first forwarded value, then Host", () => {
    process.env.AUTH_URL = "https://app.example.com/path";
    expect(appOrigin(h({ host: "x" }))).toBe("https://app.example.com");
    delete process.env.AUTH_URL;
    expect(appOrigin(h({ "x-forwarded-host": "a.test, b.test ", "x-forwarded-proto": "https, http", host: "x" }))).toBe("https://a.test");
    expect(appOrigin(h({ host: "127.0.0.1:3218" }))).toBe("http://127.0.0.1:3218");
    expect(appOrigin(h({ host: "app.test" }))).toBe("https://app.test");
    expect(appOrigin(h({}))).toBe("http://localhost:3000");
  });
});
