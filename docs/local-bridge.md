# Local bridge

## 1. What it is

The local bridge is a small program you run on your own computer. It lets the Orrery web page use the Claude Code installed on that computer. The page talks to the bridge directly, and the bridge only listens on your own machine. So the bridge only works in a browser on the same computer.

The page uses the bridge only when the Orrery server cannot run Claude Code itself, for example when Orrery is hosted on Vercel. If you run Orrery on your own machine, the server runs Claude Code and the bridge is not needed (`src/lib/bridge/client.ts`, `routeTurn`).

## 2. Start it

1. Get the latest code.

```bash
git pull
```

2. Install the packages.

```bash
npm install
```

3. Start the bridge.

```bash
npm run bridge
```

The first start creates the config file and prints a token. Copy the token now. It is shown in full only on the first start.

The config file is at `~/.orrery-bridge/config.json`. The folder is created with owner-only access, and the file is kept at owner-only read and write (`scripts/bridge.ts`, `ensureConfig`).

To show the token again, run:

```bash
npm run bridge -- --print-token
```

The bridge listens on `127.0.0.1`, port `47321` (`src/lib/bridge/constants.ts`). If the port is taken, it prints `Could not listen on 127.0.0.1:47321: ...` and exits.

## 3. Pair it with Orrery

1. Open Orrery and go to Settings > Local bridge.
2. Paste the token into "Bridge token" and click Save.
3. Click Check now. The status line shows the result.
4. In the model list, pick a Claude Code model marked "via local bridge".

Forget removes the saved token from this browser (`src/app/components/BridgeSettings.tsx`).

## 4. Allow folders

Claude Code can only work inside folders you allow. Add a folder from the terminal:

```bash
npm run bridge -- --add /path/to/project
```

Remove a folder the same way:

```bash
npm run bridge -- --remove /path/to/project
```

Rules for `--add` (`scripts/bridge.ts`, `resolveFolderArg`):

- The path must be a full path. A path that starts with `~/` also works.
- The folder must exist.
- These folders are refused:
  - the whole disk (`/`), `/Volumes` itself, and `/System/Volumes`;
  - your home folder, and any folder that contains your home folder;
  - folders that hold keys or credentials, such as `.ssh`, `.aws`, `.gnupg`, `.claude`, `.kube`, `.docker`, `.azure`, `.password-store`, `.config/gcloud`, `.config/gh`, `Library/Keychains`, `Library/Cookies`, and `Library/Application Support` inside your home folder, and any folder that contains one of these (`src/lib/files/folderRules.ts`).

The bridge checks each request again. A folder that was removed, or that became a link to a refused place, is refused on the next request with "That folder is not on the bridge's list."

Folders can only be added or removed in the terminal. The web page cannot add one.

If you pick no folder in a chat, Claude Code gets no tools at all. It can only answer from the conversation. Pick a folder to give it tools (`src/lib/cliProviders.ts`, `claudeAccessFlags`).

## 5. Modes

Set the most the page may do with `--max-mode`:

```bash
npm run bridge -- --max-mode plan
```

The default is `plan`. The page can ask for a lower mode than the maximum, but never a higher one.

| Mode | What Claude Code can do | What needs your approval |
|------|-------------------------|--------------------------|
| `chat` | Answers without tools. | Nothing. |
| `plan` (default) | Reads and searches the allowed folders. Changes nothing. | Nothing, because nothing can change. |
| `agent` | Creates and edits any file in the allowed folders. No command tools. | Nothing for edits. This includes files that run later, such as `package.json` scripts, a Makefile, and git hooks. |
| `ask` | Also runs shell commands in the allowed folders. | Each edit or command needs your OK in the page. Each command, each tool that can run code, and each edit outside the folder or in `.git`, `.husky`, `.githooks` or `.claude` also needs `yes` typed in the bridge's terminal (see section 6). |

Source for the table: `scripts/bridge.ts`, `modeNote`. The modes are ranked from lowest risk to highest: `chat`, `plan`, `agent`, `ask`.

When you start the bridge with `agent` or `ask`, it prints a warning with the command to lower the mode.

To change the mode, run the same command with the new mode name, for example:

```bash
npm run bridge -- --max-mode agent
```

## 6. Terminal confirmation

With confirmation on (the default), a command or code-running tool asked for by the page also needs your OK in the bridge's terminal.

1. The bridge prints one block with the tool name, the folder, and the command. The folder and the command are printed in quotes, with hidden characters written out:

   ```text
   Claude Code wants to run (<tool>) in "<folder>":
     "<command>"
     (<characters> characters, <lines> lines)
   Type yes to allow it (anything else denies):
   ```

2. Type the word `yes` and press Enter. Any other answer is a no. The check ignores capital letters and spaces around the word.
3. If you do not answer within 60 seconds, the bridge prints `No answer in 60 s: denied.` and says no.
4. A command longer than 4000 characters is refused without asking. The page shows "The bridge refused it: it is over 4000 characters."
5. If the bridge was started without a terminal, it cannot ask. The page then shows: "This needs confirmation in the bridge's terminal, but the bridge has no terminal. Start it from a terminal, or run `npm run bridge -- --no-confirm-shell`."
6. If the config file cannot be read at that moment, the command does not run. The page shows "The bridge's config could not be read, so the command was not run."
7. Any answer other than yes shows "It was not confirmed in the bridge's terminal."

Turn confirmation off:

```bash
npm run bridge -- --no-confirm-shell
```

When it is off, the approval in the page alone runs the command. The bridge prints: "Shell commands are no longer confirmed in this terminal: the page's approval alone runs them."

Turn it back on:

```bash
npm run bridge -- --confirm-shell
```

Source: `scripts/bridge.ts`, `terminalConfirm` and `main`.

## 7. Other flags

Allow another page address:

```bash
npm run bridge -- --origin https://your-orrery-address.example
```

- Only `http` and `https` addresses are accepted.
- It adds to the list. It does not replace the list. There is no flag that removes an address.
- The default list has one address: `https://dev-chat-beta.vercel.app`.

Let the page approve edits for a whole chat at once:

```bash
npm run bridge -- --allow-chat-wide-edits
```

This is off by default. Without it, every edit asks. There is no flag to turn it off again. To do that, set `allowChatWideEdits` to `false` in the config file.

Show the token again:

```bash
npm run bridge -- --print-token
```

Flags that change settings save the config and exit. They do not start the bridge. A running bridge reads the config on each request, so the change applies to it right away. The startup warning for `agent` and `ask` is only printed when the bridge starts.

## 8. Status messages

The page shows one of these statuses. The texts are from `src/lib/bridge/client.ts` unless noted.

| Status | Text shown | What it means | What to do |
|--------|-----------|---------------|------------|
| `unpaired` (no token saved) | "Not paired. Paste the token the bridge printed." (Settings page, `BridgeSettings.tsx`). Elsewhere: "Pair this browser with the bridge: paste its token in Settings > Local bridge." | No token is saved in this browser. | Paste the token. Show it again with `npm run bridge -- --print-token`. |
| `unpaired` (token saved) | "The bridge did not accept this token. Paste it again, or run: npm run bridge -- --print-token" (`BridgeSettings.tsx`) | The bridge answered without a version, so the saved token is wrong. | Paste the right token. |
| `offline` | "Start the bridge on this computer: npm run bridge" | The page could not reach the bridge, or got an unexpected answer. | Start the bridge in a terminal. |
| `mismatch` | "Bridge is version N, this Orrery needs 1: git pull, then npm run bridge" | The bridge and the page use different protocol numbers. | Run `git pull`, then `npm run bridge`. |
| `no-claude` | "Claude Code is not installed on this computer (or not on PATH)" | The bridge cannot find Claude Code. | Install Claude Code, or fix your PATH, then restart the bridge. |
| `blocked` | "Your browser blocked access to this computer. Allow local network access for this site, or use Chrome or Firefox" | The browser stopped the page from reaching the bridge. | Allow local network access for the site, or use Chrome or Firefox. |
| `ready` | "Connected: bridge <version>, N folder(s) allowed." (`BridgeSettings.tsx`) | Everything works. | Nothing. |

While it checks, the settings page shows "Checking the bridge…".

## 9. Limits

- The bridge works only on the same computer as the browser.
- Use Chrome or Firefox. Other browsers may block the page from reaching the bridge.
- Bridge chats use Claude Code's own tools. They do not use Orrery's memory, knowledge bases, or generated interfaces (`BridgeSettings.tsx`).
- Files attached to a message are not sent to Claude Code, and they are not saved in the chat. Only the text of your messages is sent and saved (`scripts/bridge.ts`, `src/lib/chat/saveBridgeTurn.ts`, `src/lib/bridge/client.ts`).
- Bridge chats do not get an automatic title. The chat is saved without one, so it keeps the name "New Chat" until you rename it or use Generate title in the sidebar menu (`src/lib/chat/saveBridgeTurn.ts`).
- The bridge handles up to 4 chats at the same time. A fifth gets "Too many chats are running. Wait for one to finish."
- A request can be at most 2 MB, and at most 1000 messages.
- Bridge runs do not use user-level MCP servers or connectors.

## 10. Safety notes

- The bridge listens only on `127.0.0.1`, so other computers on your network cannot reach it. A request must also use the exact host `127.0.0.1:47321` (`src/lib/bridge/protocol.ts`).
- Each request needs the token and an allowed page address.
- Folders are added or removed only in the terminal, never from the web page.
- In `agent` mode, Claude Code can edit any file in an allowed folder without asking. That includes scripts that run later, such as `package.json` scripts, a Makefile, and git hooks. Keep `plan` unless you need edits.
- Stopping the bridge (Ctrl+C) also stops every Claude Code run it started.
