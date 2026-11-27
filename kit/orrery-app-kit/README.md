# Orrery app kit

Copy `src/` (and `suite-strip.js` if you want the strip) into your app. Zero runtime dependencies: Node `crypto` and Web `Request`/`Response` only (Next route handlers, Vercel functions, Express 4+/Node 18+). No npm access needed.

| File | Purpose |
| --- | --- |
| `src/manifest.ts` | `defineManifest()` validates what you serve at `/.well-known/orrery-app.json` |
| `src/token.ts` | `verifyOrreryToken()`, `verifyHandoffToken()`, `createJtiStore()`, `OrreryAuthError` |
| `src/results.ts` | `table() timeseries() ohlc() model3d() job() link()` and `toolResult()` |
| `src/mcp.ts` | `createMcpHandler()`, `nextRouteHandler()`, `expressMiddleware()` |
| `src/sso.ts` | `ssoHandler()` for the `/sso` landing route |
| `src/SuiteStrip.tsx`, `suite-strip.js` | "Part of Orrery" strip (React / plain JS) |

The contract is `docs/design/apps-integration.md`. Env vars: `ORRERY_APP_SECRET` (shown once at registration), `ORRERY_APP_ID` (your manifest `id`), `ORRERY_ISSUER` (default `orrery`).

## Next.js (App Router), about 20 minutes

```ts
// app/.well-known/orrery-app.json/route.ts
import { defineManifest } from "@/orrery/manifest";
export const GET = () => Response.json(defineManifest({
  manifestVersion: 1, id: "statmesh", name: "StatMesh",
  baseUrl: "https://statmesh.vercel.app", description: "...", goodFor: "Run statistics on a dataset.",
  mcp: { url: "https://statmesh.vercel.app/api/mcp" }, auth: "orrery-jwt",
  sso: { path: "/sso" }, capabilities: ["table"], deepLinks: { home: "/" }, permission: "read",
}));

// app/api/mcp/route.ts
import { createMcpHandler, nextRouteHandler } from "@/orrery/mcp";
import { table, toolResult } from "@/orrery/results";
export const { POST, GET } = nextRouteHandler(createMcpHandler({
  name: "statmesh", version: "1.0.0",
  tools: [{
    name: "summary", description: "Summary stats", readOnly: true,
    inputSchema: { type: "object", properties: { dataset: { type: "string" } }, required: ["dataset"] },
    handler: async (args, { email }) => toolResult(table(["metric", "value"], [["mean", 3.2]]), `Summary for ${email}`),
  }],
}));

// app/sso/route.ts
import { ssoHandler } from "@/orrery/sso";
export const GET = ssoHandler({
  secret: process.env.ORRERY_APP_SECRET!, appId: process.env.ORRERY_APP_ID!,
  mintSession: (email) => `session=${signMySession(email)}; Path=/; HttpOnly; Secure; SameSite=Lax`,
});
```

## Express

```ts
import express from "express";
import { createMcpHandler, expressMiddleware } from "./orrery/mcp";
const app = express();
app.get("/.well-known/orrery-app.json", (_q, r) => r.json(manifest)); // manifest from defineManifest()
app.all("/api/mcp", expressMiddleware(createMcpHandler({ name: "x", version: "1", tools })));
```

## Python (FastAPI), stdlib only

```python
import base64, hashlib, hmac, json, os, time
from fastapi import FastAPI, Header, HTTPException, Request

app = FastAPI()
SECRET, APP_ID = os.environ["ORRERY_APP_SECRET"], os.environ["ORRERY_APP_ID"]
ISSUER = os.environ.get("ORRERY_ISSUER", "orrery")
seg = lambda s: base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))

def verify(authorization: str | None, skew=30):
    if not authorization or not authorization.startswith("Bearer "): raise HTTPException(401)
    h, b, s = (authorization[7:].split(".") + ["", "", ""])[:3]
    try:
        if json.loads(seg(h)).get("alg") != "HS256": raise ValueError
        good = hmac.new(SECRET.encode(), f"{h}.{b}".encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(good, seg(s)): raise ValueError
        c, now = json.loads(seg(b)), time.time()
        aud = c["aud"] if isinstance(c["aud"], list) else [c["aud"]]
        if c["iss"] != ISSUER or APP_ID not in aud or c["exp"] + skew < now or c["iat"] - skew > now: raise ValueError
        return c["sub"]
    except Exception:
        raise HTTPException(401)

@app.get("/.well-known/orrery-app.json")
def manifest():
    return {"manifestVersion": 1, "id": APP_ID, "name": "My App", "baseUrl": "https://myapp.vercel.app",
            "description": "...", "goodFor": "...", "mcp": {"url": "https://myapp.vercel.app/api/mcp"},
            "auth": "orrery-jwt", "capabilities": ["table"], "deepLinks": {}, "permission": "read"}

@app.post("/api/mcp")
async def mcp(req: Request, authorization: str | None = Header(None)):
    email, m = verify(authorization), await req.json()
    if "id" not in m: return Response(status_code=202)
    ok = lambda r: {"jsonrpc": "2.0", "id": m["id"], "result": r}
    if m["method"] == "initialize":
        return ok({"protocolVersion": "2025-03-26", "capabilities": {"tools": {}}, "serverInfo": {"name": "myapp", "version": "1"}})
    if m["method"] == "tools/list":
        return ok({"tools": [{"name": "hello", "description": "Say hi", "inputSchema": {"type": "object"}, "annotations": {"readOnlyHint": True}}]})
    if m["method"] == "tools/call":
        res = {"orrery": 1, "type": "table", "columns": ["user"], "rows": [[email]]}
        return ok({"content": [{"type": "text", "text": "1 row"}], "structuredContent": res})
    return {"jsonrpc": "2.0", "id": m["id"], "error": {"code": -32601, "message": "Method not found"}}
```

(Add `from fastapi import Response`.) For SSO, verify the `?token=` the same way, also require `purpose == "sso"`, reject a reused `jti`, set your own session cookie, and redirect to `next` only if it starts with a single `/`.

## Register in Orrery

Sign in as the owner, open Settings > Apps, paste your base URL, review the preview (manifest, origin, tools, warnings), approve. Orrery shows the app secret once: put it in your app's env as `ORRERY_APP_SECRET`, with `ORRERY_APP_ID` set to the manifest `id` and `ORRERY_ISSUER=orrery`, then redeploy. Changing origin, permission or tool set later needs re-approval.

## Security notes

- Identity is the token `sub` (user email); count usage and apply limits per user, never from tool arguments.
- Only mark tools `readOnly: true` if they truly are. With `permission: "read"` every tool must be read-only; `"actions"` apps are asked about per call for every non-read-only tool.
- Orrery treats all app results as untrusted data, never HTML, never instructions; do the same with anything coming from Orrery. Links come only from your manifest `deepLinks`.
- Keep the secret server-side only. Handoff tokens live 60 s and are single use; `createJtiStore` is in-memory per instance (serverless instances do not share it), so use a shared store if replay matters.
- Result caps: 1000 table rows, 5000 points per series, 5000 candles. Orrery stores large results as an artifact; the model sees a summary only.

## Versioning

The kit follows `manifestVersion` (currently 1). A new major in the contract means a new kit; Orrery refuses registration for an unknown major. Re-copy the kit when the contract changes.
