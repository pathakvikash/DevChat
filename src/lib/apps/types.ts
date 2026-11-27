// Shared types for the apps integration. The contract is documented in docs/design/apps-integration.md.
import { z } from "zod";

export const RESULT_TYPES = ["table", "timeseries", "ohlc", "model3d", "job", "link"] as const;
export type ResultType = (typeof RESULT_TYPES)[number];

export type AppPermission = "read" | "actions";
export type AppAuth = "none" | "orrery-jwt";

export const manifestSchema = z.object({
  manifestVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9-]{2,32}$/),
  name: z.string().min(1).max(60),
  icon: z.string().url().optional(),
  baseUrl: z.string().url(),
  description: z.string().max(400),
  goodFor: z.string().max(160),
  mcp: z.object({ url: z.string().url() }),
  auth: z.enum(["none", "orrery-jwt"]),
  sso: z.object({ path: z.string().startsWith("/") }).optional(),
  capabilities: z.array(z.enum(RESULT_TYPES)).default([]),
  deepLinks: z.record(z.string(), z.string().startsWith("/")).default({}),
  permission: z.enum(["read", "actions"]),
});
export type AppManifest = z.infer<typeof manifestSchema>;

export interface AppTool {
  name: string;
  description: string;
  inputSchema: unknown;
  /** From MCP annotations.readOnlyHint; an `actions` app asks first for every tool where this is not true. */
  readOnly: boolean;
}

/** What the client and the model-facing code see. Never contains the secret. */
export interface AppRecord {
  id: string;
  name: string;
  icon?: string;
  baseUrl: string;
  description: string;
  goodFor: string;
  mcpUrl: string;
  auth: AppAuth;
  ssoPath?: string;
  capabilities: ResultType[];
  deepLinks: Record<string, string>;
  permission: AppPermission;
  manifestVersion: number;
  approved: boolean;
  status: "ok" | "unreachable";
  tools: AppTool[];
  toolsCachedAt?: string;
}

export type OrreryResult =
  | { orrery: 1; type: "table"; title?: string; columns: string[]; rows: unknown[][] }
  | { orrery: 1; type: "timeseries"; title?: string; series: { name: string; points: [number, number][] }[] }
  | { orrery: 1; type: "ohlc"; symbol: string; interval: string; candles: { t: number; o: number; h: number; l: number; c: number; v?: number }[] }
  | { orrery: 1; type: "model3d"; format: "stl"; title?: string; file: string }
  | { orrery: 1; type: "job"; jobId: string; statusTool: string; title?: string; pollMs?: number }
  | { orrery: 1; type: "link"; label: string; link: string; params?: Record<string, string> };

export interface JobStatus {
  state: "queued" | "running" | "done" | "failed";
  progress?: number;
  result?: OrreryResult;
  error?: string;
}

export const orreryResultSchema: z.ZodType<OrreryResult> = z.discriminatedUnion("type", [
  z.object({ orrery: z.literal(1), type: z.literal("table"), title: z.string().optional(), columns: z.array(z.string()), rows: z.array(z.array(z.unknown())) }),
  z.object({
    orrery: z.literal(1),
    type: z.literal("timeseries"),
    title: z.string().optional(),
    series: z.array(z.object({ name: z.string(), points: z.array(z.tuple([z.number(), z.number()])) })),
  }),
  z.object({
    orrery: z.literal(1),
    type: z.literal("ohlc"),
    symbol: z.string(),
    interval: z.string(),
    candles: z.array(z.object({ t: z.number(), o: z.number(), h: z.number(), l: z.number(), c: z.number(), v: z.number().optional() })),
  }),
  z.object({ orrery: z.literal(1), type: z.literal("model3d"), format: z.literal("stl"), title: z.string().optional(), file: z.string() }),
  z.object({ orrery: z.literal(1), type: z.literal("job"), jobId: z.string(), statusTool: z.string(), title: z.string().optional(), pollMs: z.number().optional() }),
  z.object({ orrery: z.literal(1), type: z.literal("link"), label: z.string(), link: z.string(), params: z.record(z.string(), z.string()).optional() }),
]) as z.ZodType<OrreryResult>;

/** Implemented by src/lib/apps/registry.ts (backend slice); consumed by chat, routes and UI slices. */
export interface AppRegistry {
  listApps(userId: string): Promise<AppRecord[]>;
  getApp(userId: string, id: string): Promise<AppRecord | null>;
}
