/** Tools known not to run code: Claude Code's own file tools, web tools and its to-do list. Everything else can run
 *  something (Bash, PowerShell, Monitor and Tmux in 2.1.x, MCP tools, tools added later), so the bridge asks about it. */
export const NO_CODE_TOOLS: readonly string[] = ["Read", "Glob", "Grep", "Edit", "Write", "MultiEdit", "NotebookEdit", "WebSearch", "WebFetch", "TodoWrite"];

/** The tool list a bridge agent run gets: no command tools at all (these are the ones that ask for no permission or edit files). */
export const AGENT_TOOLS_NO_COMMANDS: readonly string[] = ["Read", "Glob", "Grep", "Edit", "Write", "MultiEdit", "NotebookEdit", "WebSearch", "WebFetch"];
/** Named as well, so a tool added to a default set cannot come back in. */
export const COMMAND_TOOLS: readonly string[] = ["Bash", "Monitor", "PowerShell", "Tmux"];

const NO_CODE = new Set(NO_CODE_TOOLS);
/** True for every tool except the allowlist: its approval from the page is also confirmed in the bridge's terminal. */
export const needsTerminalConfirm = (toolName: string): boolean => !NO_CODE.has(toolName);

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
export const isEditTool = (toolName: string): boolean => EDIT_TOOLS.has(toolName);
