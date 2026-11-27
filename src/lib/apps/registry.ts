import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withMcpClient } from "@/lib/mcp/client";
import { decryptValue, encryptValue } from "@/lib/settings";
import { fetchManifest } from "./manifest";
import { signAppToken } from "./token";
import {
  manifestSchema,
  orreryResultSchema,
  type AppManifest,
  type AppRecord,
  type AppRegistry,
  type AppTool,
  type JobStatus,
  type OrreryResult,
} from "./types";

export const LIST_TIMEOUT_MS = 5000;
export const CALL_TIMEOUT_MS = 30_000;
export const MAX_TEXT_BYTES = 256 * 1024;
export const MAX_STRUCTURED_BYTES = 1024 * 1024;

const db = prisma as any; // the App model needs `prisma generate`; keep the registry usable before then

interface AppRow {
  id: string;
  name: string;
  baseUrl: string;
  mcpUrl: string;
  manifestJson: string;
  auth: string;
  permission: string;
  approved: boolean;
  toolsJson: string;
  status: string;
  toolsCachedAt: Date | null;
  secretEnc: string;
  createdBy: string;
}

function parseTools(json: string): AppTool[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function toRecord(row: AppRow): AppRecord {
  const m = manifestSchema.parse(JSON.parse(row.manifestJson));
  return {
    id: row.id,
    name: row.name,
    icon: m.icon,
    baseUrl: row.baseUrl,
    description: m.description,
    goodFor: m.goodFor,
    mcpUrl: row.mcpUrl,
    auth: m.auth,
    ssoPath: m.sso?.path,
    capabilities: m.capabilities,
    deepLinks: m.deepLinks,
    permission: m.permission,
    manifestVersion: m.manifestVersion,
    approved: row.approved,
    status: row.status === "unreachable" ? "unreachable" : "ok",
    tools: parseTools(row.toolsJson),
    toolsCachedAt: row.toolsCachedAt?.toISOString(),
  };
}

export async function listApps(userId: string, opts: { includeUnapproved?: boolean } = {}): Promise<AppRecord[]> {
  void userId; // apps are global; the argument keeps the AppRegistry shape
  const rows: AppRow[] = await db.app.findMany({ where: opts.includeUnapproved ? {} : { approved: true }, orderBy: { name: "asc" } });
  return rows.map(toRecord);
}

export async function getApp(userId: string, id: string): Promise<AppRecord | null> {
  void userId;
  const row: AppRow | null = await db.app.findUnique({ where: { id } });
  return row && row.approved ? toRecord(row) : null;
}

export const appRegistry: AppRegistry = { listApps: (u) => listApps(u), getApp };

export async function getAppSecret(id: string): Promise<string | null> {
  const row: Pick<AppRow, "secretEnc"> | null = await db.app.findUnique({ where: { id }, select: { secretEnc: true } });
  return row ? decryptValue(row.secretEnc) : null;
}

const authHeaders = async (m: { auth: string; id: string }, email: string, secret: string): Promise<Record<string, string>> =>
  m.auth === "orrery-jwt" ? { Authorization: `Bearer ${await signAppToken({ appId: m.id, email, secret })}` } : {};

/** Lists the app's tools over MCP. readOnly comes from annotations.readOnlyHint (missing = not read-only). */
async function listLive(mcpUrl: string, headers: Record<string, string>): Promise<AppTool[]> {
  return withMcpClient(mcpUrl, { headers, timeoutMs: LIST_TIMEOUT_MS }, async (client, req) => {
    const { tools } = await client.listTools(undefined, req);
    return tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema,
      readOnly: t.annotations?.readOnlyHint === true,
    }));
  });
}

export function toolWarnings(m: Pick<AppManifest, "permission" | "auth">, tools: AppTool[]): string[] {
  const w: string[] = [];
  if (m.permission === "read") for (const t of tools) if (!t.readOnly) w.push(`permission is "read" but tool ${t.name} is not marked read-only`);
  if (m.auth === "none") w.push("auth is none: the app will not know which user is calling");
  if (tools.length === 0) w.push("no tools were listed");
  return w;
}

/** Fetch the manifest and list tools; stores nothing. Without a secret yet, tools are listed unsigned. */
export async function previewApp(url: string, ownerEmail: string) {
  void ownerEmail;
  const { manifest, origin } = await fetchManifest(url);
  const warnings: string[] = [];
  let tools: AppTool[] = [];
  try {
    tools = await listLive(manifest.mcp.url, {});
  } catch (e) {
    warnings.push(
      manifest.auth === "orrery-jwt"
        ? "Could not list tools before the app has its secret; they are listed after registration (use Refresh once ORRERY_APP_SECRET is set)."
        : `Could not list tools: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return { manifest, origin, tools, warnings: [...warnings, ...(tools.length ? toolWarnings(manifest, tools) : [])] };
}

async function liveToolsOrEmpty(m: AppManifest, email: string, secret: string): Promise<AppTool[] | null> {
  try {
    return await listLive(m.mcp.url, await authHeaders(m, email, secret));
  } catch {
    try {
      return await listLive(m.mcp.url, {});
    } catch {
      return null;
    }
  }
}

/** Stores the app (approved, as the owner confirmed in preview). A new app gets a random secret, returned once; re-registering keeps the secret. */
export async function registerApp(url: string, ownerUserId: string, ownerEmail: string): Promise<{ app: AppRecord; secret: string | null }> {
  const { manifest } = await fetchManifest(url);
  const existing: AppRow | null = await db.app.findUnique({ where: { id: manifest.id } });
  const secret = existing ? decryptValue(existing.secretEnc) : randomBytes(32).toString("base64url");
  const tools = await liveToolsOrEmpty(manifest, ownerEmail, secret);
  const data = {
    name: manifest.name,
    baseUrl: manifest.baseUrl,
    mcpUrl: manifest.mcp.url,
    manifestJson: JSON.stringify(manifest),
    auth: manifest.auth,
    permission: manifest.permission,
    approved: true,
    status: tools ? "ok" : "unreachable",
    ...(tools ? { toolsJson: JSON.stringify(tools), toolsCachedAt: new Date() } : {}),
  };
  const row: AppRow = existing
    ? await db.app.update({ where: { id: manifest.id }, data })
    : await db.app.create({ data: { ...data, id: manifest.id, secretEnc: encryptValue(secret), createdBy: ownerUserId } });
  return { app: toRecord(row), secret: existing ? null : secret };
}

const toolKey = (tools: AppTool[]) => tools.map((t) => `${t.name}:${t.readOnly}`).sort().join(",");

/** Re-fetch manifest and tools. A changed origin, permission or tool set sets approved=false until the owner re-approves. */
export async function refreshApp(id: string, ownerEmail: string): Promise<{ app: AppRecord; changed: string[] } | null> {
  const row: AppRow | null = await db.app.findUnique({ where: { id } });
  if (!row) return null;
  const { manifest } = await fetchManifest(row.baseUrl);
  if (manifest.id !== id) throw new Error(`The manifest at ${row.baseUrl} now has id "${manifest.id}", not "${id}"`);
  const secret = decryptValue(row.secretEnc);
  const tools = await liveToolsOrEmpty(manifest, ownerEmail, secret);
  const changed: string[] = [];
  if (new URL(manifest.baseUrl).origin !== new URL(row.baseUrl).origin || new URL(manifest.mcp.url).origin !== new URL(row.mcpUrl).origin) changed.push("origin");
  if (manifest.permission !== row.permission) changed.push("permission");
  if (tools && toolKey(tools) !== toolKey(parseTools(row.toolsJson))) changed.push("tools");
  const updated: AppRow = await db.app.update({
    where: { id },
    data: {
      name: manifest.name,
      baseUrl: manifest.baseUrl,
      mcpUrl: manifest.mcp.url,
      manifestJson: JSON.stringify(manifest),
      auth: manifest.auth,
      permission: manifest.permission,
      status: tools ? "ok" : "unreachable",
      ...(changed.length ? { approved: false } : {}),
      ...(tools ? { toolsJson: JSON.stringify(tools), toolsCachedAt: new Date() } : {}),
    },
  });
  return { app: toRecord(updated), changed };
}

export async function removeApp(id: string): Promise<boolean> {
  const { count } = await db.app.deleteMany({ where: { id } });
  return count > 0;
}

/** Live tool list for an approved app, falling back to the cached one (status "unreachable") when it can't be reached. */
export async function listAppTools(userId: string, email: string, appId: string): Promise<AppTool[]> {
  void userId;
  const row: AppRow | null = await db.app.findUnique({ where: { id: appId } });
  if (!row || !row.approved) throw new Error(`App "${appId}" is not available`);
  const m = manifestSchema.parse(JSON.parse(row.manifestJson));
  try {
    const tools = await listLive(row.mcpUrl, await authHeaders(m, email, decryptValue(row.secretEnc)));
    await db.app.update({ where: { id: appId }, data: { toolsJson: JSON.stringify(tools), toolsCachedAt: new Date(), status: "ok" } });
    return tools;
  } catch (e) {
    console.warn(`[apps] ${appId} unreachable, using cached tools: ${e instanceof Error ? e.message : String(e)}`);
    await db.app.update({ where: { id: appId }, data: { status: "unreachable" } }).catch(() => {});
    return parseTools(row.toolsJson);
  }
}

export interface AppCallResult {
  text: string;
  structured?: OrreryResult;
  /** Only with `opts.job`: the validated job status (structuredContent, or JSON in the text). */
  job?: JobStatus;
  isError?: boolean;
}

const jobStatusSchema: z.ZodType<JobStatus> = z.object({
  state: z.enum(["queued", "running", "done", "failed"]),
  progress: z.number().min(0).max(100).optional(),
  result: orreryResultSchema.optional(),
  error: z.string().optional(),
}) as z.ZodType<JobStatus>;

function parseJob(r: AppCallResult, structuredContent: unknown): JobStatus | undefined {
  let raw = structuredContent;
  if (raw === undefined) {
    try { raw = JSON.parse(r.text); } catch { return undefined; }
  }
  const p = jobStatusSchema.safeParse(raw);
  return p.success ? p.data : undefined;
}

/** For the file route: the app's file as a raw fetch Response, signed for this user. Null when the app is not available. */
export async function openAppFile(appId: string, email: string, name: string, signal?: AbortSignal): Promise<Response | null> {
  const row: AppRow | null = await db.app.findUnique({ where: { id: appId } });
  if (!row || !row.approved) return null;
  const m = manifestSchema.parse(JSON.parse(row.manifestJson));
  const url = new URL("/api/orrery/file", row.baseUrl);
  url.searchParams.set("name", name);
  const headers = await authHeaders(m, email, decryptValue(row.secretEnc));
  // redirect: "manual" keeps the signed bearer on the app's origin.
  return fetch(url, { headers, redirect: "manual", signal: AbortSignal.any([AbortSignal.timeout(CALL_TIMEOUT_MS), ...(signal ? [signal] : [])]) });
}

function capText(s: string): string {
  return Buffer.byteLength(s) > MAX_TEXT_BYTES ? `${Buffer.from(s).subarray(0, MAX_TEXT_BYTES).toString("utf8")}\n[truncated at 256 KB]` : s;
}

/** Validates and size-caps an MCP tool result into the shape the rest of Orrery uses. Exported for tests. */
export function shapeResult(appId: string, tool: string, result: { content?: unknown[]; structuredContent?: unknown; isError?: boolean }, skipStructured = false): AppCallResult {
  const text = capText(
    (result.content ?? [])
      .filter((c: any) => c?.type === "text" && typeof c.text === "string")
      .map((c: any) => c.text)
      .join("\n"),
  );
  let structured: OrreryResult | undefined;
  if (result.structuredContent !== undefined && !result.isError && !skipStructured) {
    const size = Buffer.byteLength(JSON.stringify(result.structuredContent));
    const parsed = size > MAX_STRUCTURED_BYTES ? null : orreryResultSchema.safeParse(result.structuredContent);
    if (parsed?.success) structured = parsed.data;
    else console.warn(`[apps] ${appId}.${tool}: structuredContent dropped (${size > MAX_STRUCTURED_BYTES ? "over 1 MB" : "not a valid orrery result"})`);
  }
  return { text, ...(structured ? { structured } : {}), ...(result.isError ? { isError: true } : {}) };
}

export async function callAppTool(
  userId: string,
  email: string,
  appId: string,
  toolName: string,
  args: Record<string, unknown>,
  opts: { signal?: AbortSignal; timeoutMs?: number; job?: boolean } = {},
): Promise<AppCallResult> {
  const t0 = Date.now();
  let ok = false;
  try {
    const row: AppRow | null = await db.app.findUnique({ where: { id: appId } });
    if (!row || !row.approved) throw new Error(`App "${appId}" is not available`);
    const tool = parseTools(row.toolsJson).find((t) => t.name === toolName);
    if (!tool) throw new Error(`App "${appId}" has no tool "${toolName}"`);
    if (row.permission === "read" && !tool.readOnly) throw new Error(`Tool "${toolName}" is not read-only and app "${appId}" only has read permission`);
    const m = manifestSchema.parse(JSON.parse(row.manifestJson));
    const headers = await authHeaders(m, email, decryptValue(row.secretEnc));
    const result = await withMcpClient(row.mcpUrl, { headers, timeoutMs: opts.timeoutMs ?? CALL_TIMEOUT_MS, signal: opts.signal }, (client, req) =>
      client.callTool({ name: toolName, arguments: args }, undefined, req),
    );
    const shaped = shapeResult(appId, toolName, result as any, opts.job);
    ok = !shaped.isError;
    if (opts.job && ok) shaped.job = parseJob(shaped, (result as any).structuredContent);
    return shaped;
  } finally {
    console.info(JSON.stringify({ evt: "app_call", userId, appId, tool: toolName, ms: Date.now() - t0, ok }));
  }
}
