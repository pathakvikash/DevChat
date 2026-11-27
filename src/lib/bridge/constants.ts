// Client-safe constants shared by the daemon, the page and the server (no node: imports).
export const BRIDGE_PORT = 47321;
export const BRIDGE_PROTOCOL = 1;
export const BRIDGE_ORIGIN = `http://127.0.0.1:${BRIDGE_PORT}`;
export const BRIDGE_MODEL_PREFIX = "claude-code/";

/** What /api/folders says on Vercel. The page reads it as the "this server cannot run your tools" signal. */
export const VERCEL_FOLDERS_REFUSED = "Working folders only work when Orrery runs on your own machine.";
/** What /api/folders says when this server cannot run CLIs at all (self-hosted production without CLI detection). */
export const SERVER_NO_CLI = "Claude Code and working folders are not available on this server.";
/** What /api/folders says to someone who is not the server's owner. */
export const HOST_TOOLS_REFUSED = "This is only available to the server's owner.";

/** Local models (Ollama, LM Studio) the bridge can serve from this computer: text only, no tools or folder. */
export const BRIDGE_LOCAL_PREFIXES = ["ollama/", "lmstudio/"] as const;
export const isBridgeLocalModel = (model: string | null | undefined): boolean => !!model && BRIDGE_LOCAL_PREFIXES.some((p) => model.startsWith(p));
