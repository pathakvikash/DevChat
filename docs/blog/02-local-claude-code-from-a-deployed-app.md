# Using local Claude Code from a deployed web app

How the hosted Orrery page talks to Claude Code on my laptop through a small bridge, and what the security reviews made me change.

When I run Orrery, my chat app, on my own machine, the server can start the `claude` CLI directly. On Vercel there is no `claude` binary, no access to my files, and no way to reach my laptop.

## The options

I looked at four ways around it:

- A small program on the laptop that the browser talks to directly.
- A program on the laptop that dials out to the server. Serverless functions run on different instances and would need a shared store to pass messages. Orrery has no such store.
- A tunnel like ngrok, which gives a machine that runs code a public address.
- Claude Code in the cloud with an API key. Then you lose your local files and your own Claude Code login.

I went with the first one. The browser calls the bridge, so no server sits between the page and the CLI. When a turn finishes, the page saves it to your account through a strict API route.

## Setting it up

In your clone of the repo:

```bash
git pull
npm install
npm run bridge
```

The bridge listens only on 127.0.0.1, port 47321, so other machines on your network cannot reach it. The first run creates `~/.orrery-bridge/config.json`, readable only by your user, and prints a pairing token once.

Keep that terminal open. Then open Orrery, go to Settings > Local bridge and paste the token. The page calls the bridge straight from your browser. Chrome and Firefox allow an https page to call 127.0.0.1. Safari blocks it, and the page tells you to use Chrome or Firefox.

## Folders are added from the terminal

The page cannot add a folder. You add it in the terminal:

```bash
npm run bridge -- --add ~/code/my-project
```

The bridge refuses your home folder, any folder that contains it, and secret folders like `~/.ssh` and `~/.aws`.

## Checks on every request

Before the bridge reads a request body, it checks four things:

- The Host header must be exactly `127.0.0.1:47321`. A page that uses DNS rebinding to point its own domain at your loopback address sends a different Host, so it fails here.
- The Origin must be in an exact allowlist. By default that is only the hosted Orrery.
- The token is 256 bits and is compared in constant time.
- A POST must be JSON.

The page can pick a model, a mode, a folder from the list and send messages. It cannot pass command-line arguments, environment variables or permission flags.

## Modes

The mode is a limit set on the bridge. The page can ask for less, never more. The default is plan.

```bash
npm run bridge -- --max-mode agent
```

| Mode | What Claude Code can do |
| --- | --- |
| chat | No tools. |
| plan (default) | Read and search the allowed folders. Changes nothing. |
| agent | Edit files in the allowed folders. No command tools. |
| ask | Edits and commands, each one approved in the page. Anything that can run code is also confirmed in the bridge's terminal by typing yes. |

## What the reviews found

Before release the bridge went through adversarial reviews, where the reviewer's job was to break it. Most findings were about who can say yes, and from where.

The biggest one was a script injection bug. A bug like that in the web page could read the saved token, drive the bridge and approve its own command card. That is code execution on your laptop. So the default became read-only, and a command now also needs `yes` typed in the bridge's own terminal. A web page cannot type there.

The first terminal check only covered tools named Bash, PowerShell or Shell. Claude Code has other tools that can run things, like Monitor and Tmux. Now every tool needs the terminal yes except a short list known not to run code: the file tools, web tools and the to-do list. In agent mode the command tools, Bash, Monitor, PowerShell and Tmux, are removed by name, so a tool added to a default set later cannot come back in.

A "y" typed before a question showed up could answer it. Now the bridge uses one input reader, drops anything typed while no question is pending, and wants the full word yes. It prints the command on one escaped line and treats no answer in 60 seconds as no.

The limit of four parallel chats could be bypassed. The slot is now claimed before any async work and freed when the connection closes.

A half-edited config file crashed the bridge. Now it answers with an error and keeps running.

## Limits

It works only in a browser on the same computer as the bridge. Bridge chats use Claude Code's own tools, not Orrery's memory, knowledge bases or generated UI. And with edits allowed, Claude Code can change files that run later, like `package.json` scripts, a Makefile or git hooks. That is why plan is the default. I would not use agent mode on a project I have not read.

Orrery: https://dev-chat-beta.vercel.app, code: https://github.com/pathakvikash/DevChat
