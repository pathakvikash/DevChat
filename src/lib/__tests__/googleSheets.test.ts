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
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    dataTable: {
      findFirst: vi.fn(async ({ where }: any) => (table && table.id === where.id && table.userId === where.userId ? table : null)),
      updateMany: vi.fn(async ({ where, data }: any) => (table?.id === where.id && table.userId === where.userId ? (Object.assign(table, data), { count: 1 }) : { count: 0 })),
    },
    dataTableRow: { findMany: vi.fn(async () => dataRows) },
  },
}));
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn(async () => "u1"), UnauthorizedError: class extends Error {} }));
vi.mock("@/lib/sanityMode", () => ({ isSanityMode: () => false }));

import { authorizeUrl, connectionState, disconnect, exchangeCode, syncTableToSheet, tableToValues, ReconnectError, SHEETS_SCOPE } from "@/lib/google/sheets";
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
function google(opts: { refreshStatus?: number; deleted?: boolean } = {}) {
  let n = 0;
  const live = new Set<string>(["good"]);
  fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
    const u = new URL(String(url));
    if (u.host === "oauth2.googleapis.com" && u.pathname === "/token") {
      const form = new URLSearchParams(String(init.body));
      if (form.get("grant_type") === "refresh_token") {
        if (opts.refreshStatus && opts.refreshStatus >= 400) return json({ error: "invalid_grant" }, opts.refreshStatus);
        live.add("fresh");
        return json({ access_token: "fresh" });
      }
      return json({ access_token: "good", refresh_token: "r1", scope: `openid ${SHEETS_SCOPE}` });
    }
    if (u.host === "oauth2.googleapis.com") return json({});
    const token = new Headers(init.headers).get("Authorization")?.replace("Bearer ", "") ?? "";
    if (!live.has(token)) return json({}, 401);
    if (init.method === "POST" && u.pathname === "/v4/spreadsheets") return json({ spreadsheetId: `sheet${++n}` });
    if (opts.deleted && u.pathname.includes("/sheetgone/")) return json({}, 404);
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
      expect(res.status).toBe(400);
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
    expect(narrow.headers.get("location")).toContain("google=failed");
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

describe("sync", () => {
  it("the first sync creates the sheet named after the table and saves its id; the next one clears and overwrites it", async () => {
    google();
    await exchangeCode("u1", "c", "http://x/cb");
    fetchMock.mockClear();
    const first = await syncTableToSheet("u1", "t1");
    expect(first).toEqual({ sheetUrl: "https://docs.google.com/spreadsheets/d/sheet1/edit", rows: 1 });
    expect(table.sheetId).toBe("sheet1");
    expect(calls().map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(["POST /v4/spreadsheets", "POST /v4/spreadsheets/sheet1/values/A:ZZ:clear", "PUT /v4/spreadsheets/sheet1/values/A1"]);
    expect(JSON.parse(String(calls()[0].body))).toEqual({ properties: { title: "Jobs" } });

    fetchMock.mockClear();
    dataRows.push({ id: "r2", status: "new", data: JSON.stringify({ title: "Two", url: "https://b.test" }) });
    const second = await syncTableToSheet("u1", "t1");
    expect(second.rows).toBe(2);
    expect(calls().map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(["POST /v4/spreadsheets/sheet1/values/A:ZZ:clear", "PUT /v4/spreadsheets/sheet1/values/A1"]);
    expect(JSON.parse(String(calls()[1].body)).values).toHaveLength(3);
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
