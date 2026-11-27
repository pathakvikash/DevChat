/** Tools that run a command: Claude Code's Bash, and the shell tools of other platforms. */
export const isShellTool = (toolName: string): boolean => /^(Bash|PowerShell|Shell)/i.test(toolName);
