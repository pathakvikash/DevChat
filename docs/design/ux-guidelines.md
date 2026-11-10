# DevChat UX guidelines for the new features

For the agents building quote-reply, export, `/compress <focus>`, temporary chat, past-chat search, message queue, @ files, side chat, fork, modes, sub-agents and agent messaging, and for the reviewer checking them.

- `docs/design/side-chat-subagents.md` owns behaviour, data and APIs. This file owns look, copy, keys, focus, motion and layout. If they disagree on anything a user can see, this file wins.
- Follow it literally. When something isn't covered here, copy the nearest existing pattern from section 1 instead of inventing one.
- No new colours, no new UI libraries, no new CSS tokens. Everything below uses what is already in the repo.

---

## 0. The rules on one screen

1. Surfaces come from the `glass*` classes in `globals.css`. Text colour comes from `text-[var(--foreground)]` or the zinc scale. Never hex, never `rgb()`.
2. Colour shows status on icons, dots, borders and tints, never on body text. Every status also has a word (`Running`, `Done`, `Failed`), so meaning never depends on colour or a spinner alone.
3. Text you add uses `text-zinc-400` or stronger. `zinc-500` is for icons and placeholders only, `zinc-600` never for text.
4. Everything stacked above the input goes in one **composer tray** (2.1), capped at `min(30dvh, 240px)`, and scrolls. The textarea keeps its 200px cap.
5. Chips and quote cards share one **tray item** pattern (2.2). Sub-agent, approval, plan and search cards share one **inline card** pattern (2.3).
6. Icon-only buttons need `aria-label` and `title`. Put the shortcut in the title, like the existing "Use suggestion (→)" (`chatInput.tsx:403`).
7. Every new interactive element gets the focus ring in 2.5.
8. A control never goes dead when the model can't use tools: replace it with the fallback, or disable it and say why (2.6).
9. Motion is short (120–200ms), uses the existing springs, and turns off with reduced motion (1.5).
10. Menus that open downward live in a bar with `relative z-20`. Overlay panels (`z-50`) always cover every chat pane (1.6).
11. Split view and the side chat are the same thing: a **chat pane** (3.8). Inside a pane, layout reacts to the pane's width (container queries), not the window's.

---

## 1. Design language in this repo

### 1.1 Surfaces and tokens

Tokens: `src/app/globals.css:10-54` (dark, the default), with overrides under `[data-theme="light"]` at `:56-89`. The theme is the `data-theme` attribute on `<html>`, set by `ThemeProvider.tsx:35`. There is no Tailwind `dark:` variant in this repo, so don't use one.

| Class | Defined | Used for today | Use it for |
|---|---|---|---|
| `glass` | `globals.css:93` | composer form (`chatInput.tsx:294`), ThinkingBlock, small badges | quiet containers, badges |
| `glass-card` | `:114-125` (hover lifts border and shadow) | message bubbles, tool cards, code blocks, attachment chips | inline cards (2.3) and tray items (2.2) |
| `glass-input` | `:127-137` (focus: accent border plus glow) | sidebar search, clarification textarea | every new text field outside the main textarea |
| `glass-button` | `:139-156` | all secondary buttons, header icons, message actions | secondary buttons |
| `glass-button-primary` | `:158-171` | Send, New Chat, active mode, user bubbles | the one primary action per surface |
| `glass-button-danger` | `:173-184` | Stop (`chatInput.tsx:573`) | Stop and destructive actions |
| `glass-panel` / `glass-panel-strong` | `:186`, `:194` | popovers (slash menu, plus menu), sidebar, overlay panels | popovers and menus (`glass-panel-strong`) |
| `glass-nav` | `:202` | conversation header, composer wrapper | the side-chat header |
| `glass-dialog` | `:209` | `CenteredDialog` | dialogs (none planned) |
| `glass-surface` | `:217` | panel headers, sidebar header | the top strip of a panel header |

Other tokens to reuse as-is: radii `--glass-radius-sm/md/lg/xl` (12/16/20/24px, `:45-48`), shadows `--glass-shadow-sm/md/lg/xl/glow` (`:32-36`), accents `--glass-accent` and `--glass-accent-strong` (blue at 0.3 and 0.5, `:52-53`), hover and active fills `--glass-bg-hover` / `--glass-bg-active`.

### 1.2 Colour, light and dark

- **The zinc scale flips in light mode** (`globals.css:79-88`): `zinc-100` becomes near-black and `zinc-900` near-white. So `text-zinc-200`, `text-zinc-300` and `text-zinc-400` work in both themes. Lean on that.
- **Tailwind colours don't flip.** `text-emerald-300`, `text-amber-300`, `text-red-200` and `text-white` are bright in both themes and nearly unreadable on the light background. Existing offenders you must not copy: the compress banners (`chatInput.tsx:264,273`), `CompressionEvent.tsx:49`, `ErrorBanner.tsx:23` (`text-red-200`), and the shortcuts dialog title (`KeyboardShortcutsDialog.tsx:61`, `text-white`).
- Status colours in use: blue-400 = running (`ToolInvocation.tsx:142`), green-400 / emerald-400 = done, red-400 = error, amber-400 = warning or waiting, purple-400 = thinking. Use them on **icons (14px), 6px dots, `border-*-900/50` borders and `bg-*-500/10` tints** only.
- `text-white` only on `glass-button-primary` and inside the user bubble, matching what exists. In light mode `glass-button-primary` is solid blue (`globals.css:454-477`, the last block) and its label is forced white, so call sites that use `text-[var(--foreground)]` render white too. Contrast of the white label: rest `#2563eb`→`#1d4ed8` 5.17:1 / 6.70:1, hover `#1d4ed8`→`#1e40af` 6.70:1 / 8.72:1, active `#1e40af`→`#1e3a8a` 8.72:1 / 10.36:1, all above the 4.5:1 AA minimum (it was 1.3 to 1.7:1 on the old 20-40% blue). Focus-visible is a 2px `#1d4ed8` outline (6.42:1 on the page). Dark mode is unchanged.
- Text inside the user bubble (blue): reuse the white-alpha set from `MessageEditor.tsx:72` (`text-white`, `text-white/80`, `border-white/20`, `bg-white/10`).

### 1.3 Type, icons, sizes, spacing

| Thing | Existing value | Where |
|---|---|---|
| Page title | `text-lg font-bold` | `ConversationHeader.tsx:97` |
| Body, inputs, menu items | `text-sm` | everywhere |
| Meta, card headers | `text-xs` | `ToolInvocation.tsx:134`, header meta `:204` |
| Hints, menu headings | `text-[11px]` | slash menu header `chatInput.tsx:304`, hint `:514` |
| Badges | `text-[10px] font-semibold` | `ArtifactReference.tsx:54` |
| Code, ids, numbers | `font-mono` | slash usage `chatInput.tsx:317` |
| Icons | 16 standalone buttons and header, 14 inside cards, menus and chips, 12 message actions and meta, 18 the composer + | `ConversationHeader.tsx:111`, `ToolInvocation.tsx:137`, `MessageActions.tsx:158`, `chatInput.tsx:432` |
| Composer buttons | `h-9` (36px), radius `--glass-radius-md` | `chatInput.tsx:429,573,581` |
| Header icon buttons | `p-1.5` plus a 16px icon (28px), radius md | `ConversationHeader.tsx:104` |
| Message action buttons | `px-2 py-1 text-xs`, radius sm | `MessageActions.tsx:156` |
| Menu rows | `px-4 py-3 text-sm` with icon and `gap-3` | `ConversationHeader.tsx:138`, `chatInput.tsx:439` |
| Card buttons | `px-3 py-1.5 text-sm`, radius md | `ClarificationForm.tsx:57,114` |
| Bubbles | radius xl, `px-4 py-3`, `max-w-[85%]` | `MessageBubble.tsx:114-120` |
| Transcript | `max-w-4xl`, `space-y-6`, `p-4` | `ChatMessages.tsx:49-50` |
| Card spacing in a message | `my-2` | `ToolInvocation.tsx:131` |

New buttons inside cards use `h-8 px-3 text-sm font-medium rounded-[var(--glass-radius-md)]` (32px, the same height as the ClarificationForm buttons).

### 1.4 Patterns to reuse

| Pattern | Copy from | Use for |
|---|---|---|
| Popover list with header hint, ↑↓, Tab/Enter, Esc | slash menu `chatInput.tsx:302-331`, keys `:351-373` | the @ file picker; side-chat history menu rows |
| Dropdown menu | header More `ConversationHeader.tsx:125-199` | side-chat history menu, the new header items |
| Segmented radio | `ModeToggle.tsx:34-61` | four modes; "Run in" choice on the plan card |
| Collapsible tool row | `ToolInvocation.tsx:131-183` | base of every inline card (2.3) |
| Answered state of a card | `ToolInvocation.tsx:49-60` | resolved approval and plan cards |
| Option and submit buttons | `ClarificationForm.tsx:57-61,107-121` | approval and plan buttons |
| Event card in the transcript | `CompressionEvent.tsx:36-77` | compression with a focus |
| Height-animated reveal | `chatInput.tsx:410-422` (spring 400/30) | tray items appearing and leaving |
| Status dots plus label | `TypingIndicator.tsx:15-21` | "talking" indicator |
| Progress pill | `TodoIndicator.tsx:47-59` | nothing new; keep it clear of the Reply pill |
| Copy then "Copied!" swap, 1.5s | `CodeBlock.tsx:15-33` | "Send to main" turning into "Added" |
| Toast (top right, 4s, success/error/info) | `Toast.tsx:52,73-83` | confirmations and errors |
| Overlay panel (right, `z-50`, spring) | `SidePanel.tsx:17-35,49,63` | nothing new; it must keep covering every pane |
| Palette actions | `useCommandPaletteActions`, `CommandPalette.tsx:28`; usage `ConversationLayout.tsx:34-40` | new palette entries |
| Slash command registry | `src/lib/commands.ts:31-173` | `/export`, `/recall`, `/side`, `/compress [focus]` |
| Shortcut list | `KeyboardShortcutsDialog.tsx:10-39`, kbd style `:91` | new shortcuts and the slash command list |
| Capability icons (Wrench = tools) | `ModelSelector.tsx:128,190-192` | pointing users to tool-capable models |
| Relative time | `getRelativeTime`, `MessageActions.tsx:200` | search results, side-chat history (export it, don't copy it) |

### 1.5 Motion

Existing: `glass-button` transitions 200ms (`globals.css:145`); the sidebar width animates 0.2s `easeInOut` (`c/layout.tsx:42-43`); overlay panels use a spring with stiffness 300 and damping 30 (`SidePanel.tsx:17-29`); the voice waveform height uses a spring with stiffness 400 and damping 30 (`chatInput.tsx:413-416`); message actions fade in over 150ms (`MessageActions.tsx:92`); cmdk items change over 100ms.

Rules for new work:

- Tray items: height `0 → auto` plus opacity, using the same 400/30 spring as `chatInput.tsx:413-416`, inside `<AnimatePresence initial={false}>`. Don't put `layout` props on tray items, because they fight the textarea's resize.
- Reply pill: opacity 0→1 and scale 0.96→1 over 120ms. Exit 80ms.
- Panes (split view and side chat): a pane opening or closing animates its width over 0.2s `easeInOut`, like the sidebar, and its neighbours give up or take back the space. While dragging a divider: no transition. In the one-pane-at-a-time layout (3.8.4), switching panes is instant, and a newly opened pane fades in over 150ms.
- Split-view drop overlay: fades in over 120ms. A drop zone's border and background change over 100ms (CSS, like the cmdk items).
- Inline cards: no entrance animation (they stream in). Expand and collapse with no animation, like `ToolInvocation`.
- **Reduced motion.** `globals.css:436-444` only stops CSS animations. framer-motion ignores it. Add `<MotionConfig reducedMotion="user">` once around the children in `ThemeProvider.tsx` (a client component). Spinners freeze under reduced motion, which is fine because the status word carries the meaning.

### 1.6 Layering (z-index)

| Layer | z | Where |
|---|---|---|
| TodoIndicator in the transcript | 10 | `TodoIndicator.tsx:49` |
| Pane dividers (split view and side chat) | 10 | new |
| **Reply pill** (absolute, inside the pane's `relative` transcript wrapper, `ConversationLayout.tsx:113`) | 20 | new |
| **Headers that open menus downward** (`ConversationHeader` root, every pane header) | `relative z-20` | new, see the pitfall below |
| Sidebar collapse handle | 30 | `c/layout.tsx:53` |
| **Split-view drop overlay** (absolute, inside the panes container, only while dragging a chat) | 30 | new, 3.8.2 |
| Mobile sidebar | 40 | `c/layout.tsx:19` |
| Overlay panels, dialogs, slash, @ and plus menus, model dropdown | 50 | `SidePanel.tsx:49`, `chatInput.tsx:303,435`, `ModelSelector.tsx:136` |
| cmdk palette | 99/100 | `globals.css:290,300` |
| Toasts | 10000 | `Toast.tsx:52` |

Pitfall: every `glass*` class sets `backdrop-filter`, and that creates a stacking context. A child's `z-[9999]` can't escape its glass parent. A menu that opens **downward** out of a glass header can end up under positioned elements in the transcript below it (the TodoIndicator at `z-10`, the Reply pill). Fix: give the header root `relative z-20`. Menus that open **upward** from the composer are fine, because the composer comes later in the DOM. New menus use `z-50`, not `z-[9999]`.

### 1.7 Breakpoints

- `sm` (640px): header icon toggles move into the More menu (`ConversationHeader.tsx:101`), and ModeToggle shows icons only (`ModeToggle.tsx:58`).
- `md` (768px): the sidebar becomes a drawer (`c/layout.tsx:19,41`). The composer hides the model picker, folder picker, context circle and hint (`chatInput.tsx:514,524,528,539`).
- Review width for narrow screens: **400px**. No horizontal page scroll. Touch targets are at least 32px.
- **Inside a chat pane, use container queries, not viewport breakpoints.** A 360px pane on a 1440px screen is "wide" to `md:` but narrow in practice. Each pane root gets `@container`. Responsive classes inside the pane (the composer at `chatInput.tsx:514,524,528,539`, its tray, the pane header) switch from `sm:`/`md:` to `@md:` (448px) / `@xl:` (576px). Tailwind v4 has this built in, with no plugin. With one full-width pane this behaves exactly like today.
- Panes side by side, by window width: **3** at 1440px and up, **2** from 768px to 1439px, **1** below 768px. Each pane also needs at least 360px; see 3.8.2.

### 1.8 Existing gaps you must not copy

- No `focus-visible` styles anywhere (only `glass-input:focus` and `MessageEditor.tsx:71`). New elements add the ring in 2.5.
- Icon buttons with only `title` and no `aria-label` (header icons, `ConversationHeader.tsx:93-131`).
- AttachmentChip's × appears only on hover (`AttachmentChip.tsx:47`), so touch and keyboard users can't find it. New chips show × all the time.
- `/help` is registered (`commands.ts:166`) but not handled. It falls through to "Unknown command" (`runCommandAction.ts:130-131`). Section 2.9 fixes it.
- Mixed `...` and `…`. New copy uses `…`.
- `text-zinc-600` for hint text (`chatInput.tsx:514`) is below contrast in dark mode. The queue hint that replaces it uses `zinc-400`.

---

## 2. Shared patterns

### 2.1 Composer tray

Everything that stacks above the input goes in one block inside the composer wrapper (`chatInput.tsx:236`), above the `<form>`. The form, its wrapping and its `expanded` ordering (`:293-334`) stay untouched. Don't put cards inside the form.

```
glass-nav px-4 py-3
├─ Status rows        (always visible, no scroll)   compressing / compressed banners, agents "talking"
├─ Scroll area        mb-3 space-y-2 max-h-[min(30dvh,240px)] overflow-y-auto
│   ├─ Queued messages   (2.2 row items)    section 3.6
│   ├─ Quote cards       (2.2 row items)    section 3.1
│   └─ Files             (2.2 file chips)   uploads + @ files, section 3.7
└─ <form>             unchanged; textarea max 200px (chatInput.tsx:22)
```

- The order is fixed: things already sent but waiting (queue) sit nearest the transcript, then what you're composing, then files sitting right above the text box.
- When an item is added and the scroll area overflows, scroll it into view (`scrollIntoView({ block: "nearest" })`).
- Each group with two or more items gets a one-line heading in the slash-menu heading style: `text-[11px] text-zinc-400` with a 11px icon, a label on the left and an optional hint on the right. A single item needs no heading.
- Exception, Files: the existing "Attachments (n)" heading and "Clear all" (`chatInput.tsx:239-249`) are restyled to that heading style and read **Files (n)** and **Clear all**. They show from one file up, as today.
- At 400px wide and 700px tall, at least 160px of transcript must stay visible with three cards open.
- The send button is enabled when the textarea has text **or** there's at least one quote card or file.

### 2.2 Tray items (quote cards, queued messages, files)

Same look for all of them. Two shapes.

**Row item** (full width: quote cards and queued messages)

```
<div role="listitem" class="group relative glass-card rounded-[var(--glass-radius-md)] px-3 py-2 pr-9 text-sm">
  [14px leading icon, text-zinc-500]  [content, min-w-0]
  [× button, absolute top-1.5 right-1.5]
</div>
```

**File chip** (wraps in a row: uploads and @ files). Keep the `AttachmentChip` layout (`AttachmentChip.tsx:25-51`: a 40px icon tile, the name in `text-sm font-medium`, the size in `text-xs`). Widen its props to `{ name, size, icon?, note? }` so @ files can use it too. Change the × to always visible (see below).

The × button (identical everywhere):

- `flex h-6 w-6 items-center justify-center rounded-[var(--glass-radius-sm)] text-zinc-500 hover:text-[var(--foreground)] hover:bg-[var(--glass-bg-hover)]`, with a lucide `X` at 14px.
- Always visible. Touch and keyboard users must see it.
- `aria-label` is `Remove quote 2`, `Remove queued message`, or `Remove <filename>`.

Containers: `role="list"` with `aria-label` set to `Queued messages`, `Quotes` or `Files`.

Motion: 2.1 / 1.5 (height plus opacity, spring 400/30).

Focus after removing: the next item's main control, else the previous one, else the main textarea. Never `<body>`.

### 2.3 Inline transcript cards (sub-agent, approval, plan, search results)

Built on the tool row (`ToolInvocation.tsx:131-183`). Every card has the same skeleton. A small shared `src/app/components/ui/InlineCard.tsx` (header, body, footer slots) is worth adding, because four features use it.

```
<div role="group" aria-labelledby=… class="my-2 glass-card rounded-[var(--glass-radius-md)] overflow-hidden">
  HEADER  flex items-center gap-2 px-3 py-2 bg-[var(--glass-bg-elevated)] text-xs
          [chevron 14 if expandable] [status icon 14] [title: font-medium text-zinc-200 truncate]
          [meta: ml-auto text-zinc-400 tabular-nums shrink-0] [header action, e.g. "Open"]
  BODY    px-3 py-2 text-sm  (optional; collapsible bodies start collapsed unless stated)
  FOOTER  flex flex-wrap items-center justify-end gap-2 px-3 py-2 border-t border-[var(--glass-border)]
          [secondary buttons: glass-button] … [primary: glass-button-primary text-white]  (primary is last, on the right)
</div>
```

| State | Icon (14px) | Word in the header meta |
|---|---|---|
| Running | `Loader2 animate-spin text-blue-400` | `Running` (or live detail) |
| Waiting for the user | `ShieldQuestion text-amber-400` | `Waiting for you` |
| Done | `CheckCircle2 text-green-400` | `Done` |
| Failed | `XCircle text-red-400` | `Failed` |
| Stopped or cancelled | `Square text-zinc-400` | `Stopped` / `Cancelled` |
| Timed out | `Clock text-amber-400` | `Timed out` |

- A card that needs the user (approval, plan) gets `border-amber-900/50`, the same border as the compress banner (`chatInput.tsx:263`). Every other card keeps the default border.
- The header stays on one line in every state (`truncate` on the title, `shrink-0` on the meta), so status changes never change its height.
- Live numbers (steps, elapsed time, tokens) use `font-mono tabular-nums`.
- Cards never move focus when they appear. When one needs the user, the pane's live region announces it once (2.5).
- At 400px the footer buttons wrap (`flex-wrap`). They never shrink below `h-8`.

### 2.4 Popovers and menus

- Lists that filter as you type (slash, @): copy the slash menu (`chatInput.tsx:302-331`). Container `absolute bottom-full left-0 right-0 mb-2 max-h-72 overflow-y-auto rounded-[var(--glass-radius-md)] glass-panel shadow-2xl z-50`; heading row `text-[11px] text-zinc-400` with ↑↓ and Tab/Enter hints; active row `bg-[var(--glass-bg-hover)]`.
- Action menus (side-chat history): copy the header More menu (`ConversationHeader.tsx:134-197`) with `z-50`. Rows `px-4 py-3 text-sm` with a 14px icon. Add `role="menu"` / `role="menuitem"`. Close on outside mousedown, Esc and selection, then return focus to the trigger.
- Only one popover is open per pane at a time. Slash and @ never show together.

### 2.5 Buttons, focus, live regions

- Focus ring for every new button, link, chip and segment: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent-strong)]`. Text fields use `glass-input`, which already has a focus style.
- One primary button per surface. Destructive actions use `glass-button-danger`, except Deny, which is an ordinary secondary button (denying is safe).
- A disabled control that needs an explanation uses `aria-disabled="true"` (not `disabled`), so it stays focusable and its `title` still shows. Clicks do nothing, except on touch, where a tap shows the same text as an `info` toast.
- Each pane has one visually hidden `<div aria-live="polite" class="sr-only">`. Announce only: "Quote added", "Message queued", "Queued message delivered", "Needs your OK: <action>", "Plan ready", "Sub-agent <title>: done|failed|timed out|stopped". Never per step or per token.

### 2.6 Models that can't use tools

Compute one boolean per pane, once: `toolsAvailable = modelInfo.supportsTools !== false && !conversation.chatOnlyMode` (`supportsTools` comes from `/api/models`, `conversation/types.ts:46`). Every feature reads this value. Don't scatter separate checks.

Rule, in order:

1. **Replace.** If a fallback exists, show it in the same place, doing the same job: `/recall` instead of the searchChats tool, an "Approve plan" button instead of the plan card, "sends when the reply finishes" instead of mid-reply delivery.
2. **Disable and explain.** If there is no fallback (the Ask and Agent modes), keep the control visible with `aria-disabled`, and use this tooltip and tap toast: **"Needs a model that can use tools. Pick one with the wrench icon."**
3. **Hide** only model-started surfaces (sub-agent cards, agent messaging). There was never a control for them, so nothing disappears.

Why not hide everything: controls that vanish when you switch models look broken, shift the layout, and give no hint about how to get the feature back. Why not disable everything: a disabled button with a working alternative next to it is a dead end.

### 2.7 Copy rules

- Sentence case everywhere. No "Please", no exclamation marks, no trailing full stop on buttons, labels or toasts that are one sentence.
- Say "chat", not "conversation", in new copy.
- In-progress text ends with `…` (one character).
- Errors: `Couldn't <verb> <thing>` plus the fix if there is one, for example "Couldn't search past chats. Try again." Keep toasts under 60 characters.
- Shortcuts: tooltips write `⌘\` and `⌘↵` on Mac and `Ctrl+\` and `Ctrl+Enter` elsewhere. Work out the platform once, in `src/lib/utils`. The shortcuts dialog keeps its `Cmd` kbd style.
- Name things the same everywhere: **Side chat**, **Main chat**, **Temporary chat**, **Sub-agent**, **Queued**, modes **Chat / Plan / Ask / Agent**.

### 2.8 Keyboard map and Esc order

| Key | Where | Does |
|---|---|---|
| ⌘K | anywhere | palette (existing) |
| ⌘/ | anywhere | shortcuts dialog (existing) |
| ⌘↵ | anywhere except a quote card | sends from the **focused pane**: cards plus text |
| ⌘↵ | quote card instruction box | sends only that card. Must `stopPropagation` (see the companion doc, 3.9) |
| ↵ / ⇧↵ | main textarea | send everything, or queue while a reply runs / newline (unchanged) |
| ↵ | quote card instruction box | send everything (same as ↵ in the textarea) |
| ⌘\ | anywhere | toggle the side chat of the focused pane's chat |
| Ctrl+\` / Ctrl+⇧+\` | anywhere, two or more panes open | focus the next / previous pane (its textarea). The same keys on every platform: ⌘\` is taken by macOS, and ⌘1–9, ⌘[ and ⌘] are taken by the browser |
| @ | textarea, at the start or after a space, with a working folder set | file picker |
| ↑ ↓, Tab / ↵ | slash or @ picker | move, pick |
| ← → | mode switch, plan "Run in" | move the selection (roving tabindex) |
| ← → (⇧ for big steps) | a pane divider | resize by 16px (64px with ⇧) |

**Esc**, first match wins:

0. Dragging a chat over the panes: the browser cancels the drag. Remove the drop overlay on `dragend`.
1. An open popover (slash, @, history, More, mode or model chip, pane switcher): close it and return focus to its trigger or the textarea.
2. An overlay panel or dialog: close it (existing `closeTopDialog`, `useConversationPage.ts:259`).
3. The Reply pill is showing: hide it (keep the selection).
4. Editing a queued message: cancel the edit.
5. Focus is in a quote card's instruction box: move focus to the main textarea. The card stays.
6. Otherwise nothing. Esc never closes a pane (side chat included) and never stops a reply. ⌘W is never taken over: it closes the browser tab.

### 2.9 Discoverability

- **Palette.** Add an optional `shortcut?: string` to `CommandPaletteAction` (`CommandPalette.tsx:11-16`), rendered as `ml-auto text-[11px] text-zinc-400`. New groups and entries:
  - **Chat:** New temporary chat · Toggle side chat (⌘\\) · New side chat · Search past chats (fills `/recall ` in the input) · Export as Markdown · Compress chat (fills `/compress ` in the input).
  - **Mode:** Mode: Chat · Mode: Plan · Mode: Ask · Mode: Agent. Disabled per 2.6, with the reason as the label suffix "· needs tools".
  - **Approvals** (shown only when something is allowed): Reset allowed tools.
  - **Split view** (not shown in the one-pane-at-a-time layout): Open in split view, which lists the 8 most recent chats that aren't open (each item is the chat title with a 16px `Columns2` icon, and cmdk filters as you type) · Close this pane · Close other panes · Focus next pane (Ctrl+\`) · Focus previous pane (Ctrl+⇧+\`). At the pane limit the "Open in split view" items are disabled with the suffix "· close a pane first".
- **`/help`** opens `KeyboardShortcutsDialog` with a new **Slash commands** group generated from `SLASH_COMMANDS` (usage in `font-mono`, then the description). This fixes the unhandled `/help`.
- **Shortcuts dialog** (`KeyboardShortcutsDialog.tsx:10-39`), new rows: `Cmd \` Toggle side chat · `Cmd Enter` in a quote: send just that quote · `Enter` in a quote: send everything · `Esc` in a quote: back to the message box · `Enter` while a reply runs: queue · `@` mention a file (needs a working folder) · `` Ctrl ` `` Focus next pane · `` Ctrl Shift ` `` Focus previous pane · Drag a chat from the sidebar onto the chat area: open in split view.
- **Palette Shortcuts group** (`CommandPalette.tsx:127-140`): add `Cmd+\` Toggle side chat.
- **Tooltips carry the shortcut**: "Close side chat (⌘\\)", "New side chat".
- **Empty state** (`EmptyState.tsx`): one tips line under the paragraph, `mt-4 text-xs text-zinc-400`, with kbd chips in the `KeyboardShortcutsDialog.tsx:91` style: `/ commands · @ files · ⌘\ side chat · select text to quote it`. No tours, no popups.

---

## 3. Features

### 3.1 Quote-reply [P1]

**Reply pill**

- **Shows when** a non-empty selection starts and ends inside one `[data-message-id]` element in this pane, on mouseup or keyup. Never for selections in the composer, a quote card, a header, a dialog, or a read-only sub-agent viewer (it has no input).
- **Position**: `absolute z-20` inside the pane's transcript wrapper (`ConversationLayout.tsx:113`). Centred on the selection, 8px above its top edge. Flip to 8px below if that would be within 48px of the wrapper's top, or on touch devices (`(pointer: coarse)`), so it doesn't cover the native copy menu. Clamp 8px inside the wrapper's left and right edges, which matters for wide code blocks.
- **Look**: one `inline-flex h-8 items-center rounded-full glass-panel-strong` bar (`role="group"`, name "Selected text actions") holding up to three buttons (`focus-ring`, `text-xs font-medium`) separated by 1px dividers in `--glass-border-strong`:
  1. **Start a side chat** (14px `MessageSquarePlus`), `aria-label="Start a side chat about the selected text"`. Shown in a main chat (not a side chat or sub-agent pane) at 768px or wider. Below that a side chat can't open, so the option is left out.
  2. **Reply** (14px `TextQuote`), `aria-label="Reply to selected text"` (tests match it with `exact: true`).
  3. An icon-only mic (`Mic`), `aria-label="Reply to selected text by voice"`. Hidden when the browser has no Web Speech API, and in a side chat (no composer takes dictation there).
- **Clamp**: the edge clamp uses the pill's width, estimated from which buttons it shows (about 246px with all three).
- **Click**: the bar has `onMouseDown={e => e.preventDefault()}` so the selection survives. Use the text captured at mouseup. Clear the selection and hide the pill.
  - **Start a side chat** opens (or focuses) this chat's side chat and puts the selection above its box as its one quote (a new one replaces the old). The side chat is not sent until the user sends. If the side pane can't open (the "Close a pane first" case), the selection becomes a normal quote card here instead, so it is never lost.
  - **Reply** adds a quote card.
  - **Mic** adds a quote card, then starts dictation into that card's instruction.
- **Hide on**: pane scroll, window resize, selection collapse, Esc, an overlay opening, and after a click.
- **Chrome stays out of quotes**: add `select-none` to every bit of UI inside a message: code-block header (`CodeBlock.tsx:23`), ThinkingBlock toggle, tool and card headers and footers, badges, the MessageActions row, timestamps.

**Quote cards** (row items, 2.2)

```
[TextQuote 14]  ┃ quoted text, italic, line-clamp-3 (line-clamp-2 below md)             [×]
                [ Add an instruction (optional)                         ] ⌘↵ this quote · ↵ all
```

- Quote: `border-l-2 border-zinc-600 pl-2 text-xs italic text-zinc-400 whitespace-pre-wrap` (a scaled-down version of the markdown blockquote, `MarkdownMessage.tsx:48`). `title` holds the first 300 characters of the quote.
- Instruction: a single-line `<input>` in `mt-1.5 w-full bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-zinc-500`. The card shows the focus as `border-[var(--glass-accent)]` via `focus-within`.
- Hint `⌘↵ this quote · ↵ all` in `text-[11px] text-zinc-400`, only while that card's input has focus, and only from `md` up.
- Group heading when there are two or more cards: `Quotes (n)`.
- Buttons at the card's top right, before ×: a mic (`aria-label="Dictate into quote N"`, hidden without Web Speech) and **Ask in a side chat** (`MessageSquarePlus`, `aria-label="Ask quote N in a side chat"`, shown where the pill's side-chat option is). The side-chat button moves the card: the side chat opens with it, and the card leaves the composer only once the side chat has it (if no pane can open, the card stays).
- **Dictation**: one runs at a time and writes into one target: the main box or one card's instruction. Starting it for a card while another target listens moves the target. Removing or sending the target card stops it. A listening card's mic uses the main mic's active look (`glass-button-primary`, `mic-pulse`).

**Keys and focus**

- Clicking Reply adds the card at the end and focuses its instruction box.
- ⌘↵ in a card sends only that card, removes it, and moves focus to the next card's input, else the textarea.
- ↵ in a card sends everything. Esc goes back to the textarea (2.8). × follows the 2.2 focus rule.
- While a reply runs, ↵ or ⌘↵ queues instead: everything composed becomes one chip (3.6).

**Sent bubble**: the user bubble renders `>` runs as a quote block: `border-l-2 border-white/40 pl-3 text-white/80 italic`. The rest stays plain text (companion doc 3.9).

**States**

- Many cards: the tray scrolls (2.1).
- Pane switch or chat switch: cards are dropped. No confirm.
- Empty instruction: the card sends quote only.

**Pitfalls**

- The pill must not appear while the user is still dragging (wait for mouseup).
- Don't measure the selection with `getClientRects()[0]`; use `getBoundingClientRect()`.
- Don't render the pill in a portal on `<body>`: it would float above overlay panels.

### 3.2 Export to Markdown [P1]

- **Entry points**: the header More menu item that already exists, "Export Markdown" (`ConversationHeader.tsx:184-190`; keep the label and position), `/export` (usage `/export`, description **Download this chat as Markdown**, kind `action`), and the palette entry "Export as Markdown".
- **Behaviour**: the download starts at once, with filename `<safe title>.md` (the existing rule, `ConversationHeader.tsx:80`). It must include every message shown, including ones sent this session. Today `handleExport` reads `conversation.messages` from page load (`:67`), which is stale.
- **Feedback**: success toast **Exported "<title>.md"**. Error toast **Couldn't export this chat**.
- **Allowed while a reply streams**: it exports what's saved so far. No extra copy.
- **Temporary chats**: allowed. It's the user's way to keep one.

### 3.3 `/compress [focus]` [P1]

- **Registry**: change the existing entry (`commands.ts:127-133`) to usage `/compress [focus]`, description **Compress the chat to save context. Add a focus to keep it in detail.** Not `requiresArg`.
- **While compressing**: the existing amber row (`chatInput.tsx:262-269`) reads **Compressing chat…** or **Compressing chat, keeping "<focus>"…** (focus cut at 40 characters with `…`). Fix its text colour to `text-[var(--foreground)]`; keep the amber spinner border.
- **Done**: the existing toast "Conversation compressed" becomes **Chat compressed**. The `CompressionEvent` card adds a meta item `· Focus: <focus>` (`text-zinc-400`, `CompressionEvent.tsx:58-70`), and its title colour moves from `text-emerald-200` to `text-[var(--foreground)]`, keeping the emerald icon.
- **While a reply runs**: don't queue it. Info toast **Wait for the reply to finish, then compress**. The input keeps the command text.
- **Error**: toast **Couldn't compress the chat** (existing behaviour, new wording).

### 3.4 Temporary chat [P1]

**Turning it on**

- Header button, shown only while the chat has **no messages**, placed left of ModeToggle (`ConversationHeader.tsx:99`). It's a toggle with `aria-pressed`, 16px `MessageSquareDashed`, and the label **Temporary** (`hidden sm:inline`, icon only below sm). Style: off `glass-button text-[var(--foreground)]`; on `glass-strong border-dashed border-[var(--glass-border-strong)] text-[var(--foreground)]`. Same box as the header icon buttons (`p-1.5`, radius md; with label `px-2.5 h-7 text-xs gap-1.5` like ModeToggle). With two or more panes open, the compact pane header has no room for this button, so it becomes the **Temporary chat** checkbox item in the pane's More menu (3.8.1).
- Tooltip: **Temporary chat: not saved in your history, no memory. Deleted when you leave or after 24 hours.**
- Palette: **New temporary chat** creates a chat with the flag on and opens it.
- After the first message the toggle disappears. Turning it off later isn't offered: start a new chat.

**The indicator** (calm, and in three places, so it's always in view)

1. **Header meta row** (`ConversationHeader.tsx:203-210`): first item `inline-flex items-center gap-1 text-xs text-zinc-400` with a 12px `MessageSquareDashed` and **Temporary chat · deleted when you leave**. The title reads **Temporary chat** until the chat has a real title.
2. **Composer**: the form border goes dashed: add `border-dashed border-[var(--glass-border-strong)]` to the form (`chatInput.tsx:294`). Placeholder when empty: **Temporary chat. Not saved after you leave.**
3. **Empty state**: a 40px `MessageSquareDashed` icon (`text-zinc-400`) in place of the emoji, title **Temporary chat**, body **Not in your history or search, and memory is off. Deleted when you leave or after 24 hours.**

**Elsewhere**

- Not listed in the sidebar or in search results.
- More menu "Memory" item: `aria-disabled`, label **Memory (off in temporary chats)**.
- No confirm when leaving. The indicator already says it. Export (3.2) and Fork (3.9) are how to keep it.
- Opening a deleted temporary chat shows the existing "Conversation not found" card (`ConversationLayout.tsx:68-75`). Change its copy to **This chat no longer exists**.

**Don't**: amber or red, a banner across the page, a pulsing badge, or a modal. Dashed lines and the icon are the whole signal.

### 3.5 Search past chats [P1]

**Tool card** (inline card, 2.3) for `searchChats`

- Header: 14px `History` icon, title **Searched past chats for "<query>"**. Meta: `Running`, then **4 chats**, or **No matches**.
- Body (open by default once done): up to 5 rows, then a **Show 3 more** text button (`text-xs text-zinc-400 hover:text-[var(--foreground)]`).
- Each row is a Next `<Link href="/c/<id>">` styled `block rounded-[var(--glass-radius-sm)] px-2 py-1.5 hover:bg-[var(--glass-bg-hover)]`:
  - line 1: title `text-sm text-zinc-200 truncate`, then meta `text-[11px] text-zinc-400 shrink-0` "2d ago · <model short name>"
  - line 2: snippet `text-xs text-zinc-400 line-clamp-2`; matches in `<mark class="bg-[var(--glass-bg-active)] text-[var(--foreground)] rounded px-0.5">`
  - the current chat gets a `This chat` badge (the `ArtifactReference.tsx:54` badge style)
- It's a real link, so ⌘-click opens a new tab. A plain click navigates; the transcript is saved, so nothing is lost.
- Empty: **No past chats matched "<query>"**. Error: header `Failed` and the body **Couldn't search past chats**.

**`readChat`**: a single-line card (header only): `FileText` 14, **Read "<title>"** as a link, meta `Done`.

**`/recall <query>`** (models without tools, also available to all models): usage `/recall <query>`, description **Search your past chats and use them in the answer**, `requiresArg`. It renders the **same card** inside the user's message; the user bubble shows `/recall <query>`, not the injected text. Pitfall: `/search` today pastes raw results into the user bubble (`runCommandAction.ts:33`). Don't copy that.

Temporary chats never appear in results.

### 3.6 Message queue [P2]

**Typing during a reply**

- The hint in the button row (`chatInput.tsx:515`) changes to **Enter queues · the model sees it at its next step**, or with no tools (2.6) **Enter queues · sends when the reply finishes**. Colour `text-zinc-400`.
- A **Queue** button appears left of Stop when the textarea has text during a reply: `glass-button h-9 px-3 text-sm font-medium text-[var(--foreground)]`. It's the only way to queue on touch keyboards. Stop stays.

**Queued items** (row items, 2.2, first group in the tray)

```
Queued (2)                                   the model sees these at its next step
[Clock 14]  first two lines of the message, text-zinc-300, line-clamp-2, whitespace-pre-wrap   [×]
```

- Composed quotes show their `>` lines in the quote style from 3.1.
- **Edit**: click the text or press Enter on the focused item. It becomes a `glass-input` textarea (auto-grows to 4 lines). ↵ saves, ⇧↵ adds a newline, Esc cancels. While saving: 12px `Loader2` next to ×.
- **Delivered** (edit or remove got 409): the item turns read-only at 60% opacity with a 14px `Check` and **Delivered**, and leaves when its bubble appears.
- **Failed to queue**: a 14px `AlertTriangle` (amber-400) and **Not queued** with a **Retry** text button. The text is never lost.
- **From another agent** (3.12): a 14px `Bot` icon and the prefix **From "<sender pane title>":**, not editable, × only.

**Delivery in the transcript**: split the assistant bubble at the marker, so the transcript reads assistant, then user, then assistant: the reply so far, a normal right-aligned user bubble with the caption **Sent while replying** under it (`text-[11px] text-zinc-400`, right-aligned), and then the reply continuing in a new assistant bubble. Only the last segment gets MessageActions. Don't nest a blue bubble inside the grey reply card.

**Stop**: undelivered texts go back into the textarea in queue order, then any text already there, joined by blank lines. The cursor goes to the end and the textarea gets focus. No toast.

**Pitfalls**

- Don't queue slash action commands. They run at once if safe (`/side`, `/export`, `/help`), otherwise use the 3.3 toast.
- Hold Enter key repeat: one chip per keydown with `!e.repeat`.

### 3.7 @ files [P2]

- **Trigger**: `@` at the start of the text or after whitespace, only when the pane has a working folder. `a@b` doesn't trigger. With no folder, `@` is plain text and nothing pops up. The folder picker tooltip (`WorkingFolderPicker.tsx:21`) gains **Type @ to mention a file.**
- **Picker**: the slash-menu shell (2.4). Heading: 11px `AtSign` and **Files in <short folder> · ↑↓ to navigate · Tab/Enter to select**. Each row: 14px `FileText` (`text-zinc-500`), name `text-sm text-[var(--foreground)]`, folder `text-xs text-zinc-400 truncate`, size `ml-auto text-[11px] text-zinc-400 font-mono`. At most 50 rows; filter on the text after `@`.
  - Loading: one row with 12px `Loader2` and **Loading files…**
  - Empty: **No files match "<text>"**
  - Error: **Couldn't list files**
- **Picking a file** removes `@text` from the textarea and adds a file chip (2.2) to the Files group, using a `FileText` tile in place of the paperclip. Focus stays in the textarea. Picking the same file twice does nothing.
- **Trimmed content**: the chip gets a note line, 12px `AlertTriangle` (amber-400) and `text-xs text-zinc-400`, **Trimmed to fit <model>: <sent> of <size> sent**. The chip in the sent bubble shows the same note. If the trim is only known after sending, show it only on the sent chip.
- **Pitfalls**: Esc closes the picker and keeps the typed `@text`. The slash and @ pickers never show together. Don't put file contents in the textarea.

### 3.8 Chat panes: split view and side chat [P3]

Split view puts several existing chats side by side (like the split view in the Claude desktop app). A side chat is one more pane, holding a child chat. Both use **one pane design**. 3.8.1 is shared, 3.8.2 is split view only, 3.8.3 is side chat only, and 3.8.4 covers narrow screens for both.

#### 3.8.1 The pane (shared)

A pane is a full chat: header, transcript, composer, with its own model, mode, queue, quote cards and @ files. Panes sit in one flex row to the right of the sidebar, separated by dividers.

```
<section role="region" aria-label="<title>" class="@container relative flex min-w-0 flex-col bg-[var(--background)]">
  HEADER      glass-nav relative z-20 px-3 py-2
    line 1    h-8  [title, text-sm font-semibold truncate]                 [line-1 actions, 28px icon buttons] [X]
    line 2    flex flex-wrap items-center gap-1.5 min-h-6   [mode chip ▾] [model chip ▾]  meta items (text-[11px] text-zinc-400)
  ERROR       the existing header error block (ConversationHeader.tsx:212-224), with mx-3 mt-2 text-xs
  TRANSCRIPT  relative flex-1 min-h-0    (Reply pill, TodoIndicator)
  COMPOSER    ChatInput with its tray (2.1)
</section>
```

**Header.** With **one pane open**, the existing `ConversationHeader` stays exactly as it is. As soon as a second pane opens, **every** pane, the first included, switches to this compact header so all panes look alike. Closing back to one pane brings `ConversationHeader` back.

| | Chat pane | Side chat pane |
|---|---|---|
| Title (line 1) | chat title, `title` attribute holds the full text | side chat title, or **Side chat** |
| Line-1 actions | More (`MoreHorizontal`), Close | Older side chats (`History`), New side chat (`SquarePen`), Dock left / Dock right (`PanelLeft` / `PanelRight`, showing where it will go), Close |
| Mode chip | current mode; opens the four-mode menu | a static **Chat** chip, `aria-disabled`, tooltip **Side chats are always in Chat mode** |
| Model chip | yes | yes |
| Line-2 meta | **Temporary chat** (3.4), **Forked from …** (3.9), the two-writer warning (3.8.2) | **Sees "<parent title>" live** (3.8.3) |
| More menu | the existing More items (`ConversationHeader.tsx:136-197`: Scratchpad, Artifacts, Memory, Advanced, Shortcuts, Export Markdown, Export JSON), Reset allowed tools (3.10), **Temporary chat** (a checkbox item, only while the chat is empty), **Close other panes** | none |

- **Mode chip**: `inline-flex h-6 items-center gap-1 rounded-[var(--glass-radius-sm)] glass-button px-2 text-[11px] font-medium text-zinc-300`, with the mode's 12px icon, its label and a 10px `ChevronDown`. It opens a 2.4 menu: `menuitemradio` rows with `aria-checked`, a 14px icon, the label, and the 3.10 tooltip text as a second line (`text-xs text-zinc-400`). Ask and Agent are disabled per 2.6. Why not the segmented ModeToggle: four segments, a model picker and a title don't fit in 360px.
- **Model chip**: `ModelSelector` gets a `size="chip"` variant: the same box as the mode chip, the short model name truncated at 140px, the Eye icon kept. Its dropdown opens **downward** and is aligned `left-0` (not `right-0` as in `ModelSelector.tsx:136`), `w-72 max-w-[calc(100vw-2rem)]`, so it never runs off the leftmost pane.
- Overlay panels opened from a pane's More menu (Artifacts, Scratchpad, Advanced, …) show that pane's chat title as their `subtitle` (`SidePanel.tsx:11,71`), so it's clear which chat they belong to.

**Focused pane** (only with two or more panes; subtle on purpose):

- The focused pane is the one that last got focus or a pointer-down inside it. After a reload, it's the one saved in the URL, else the first.
- Signal: its header title is `text-[var(--foreground)]` and its composer form has `border-[var(--glass-border-strong)]`. Other panes have a `text-zinc-400` title and the default form border. Nothing else: no accent bar, no glow, no tint, which would compete with the composer's own focus glow.
- Shortcuts (⌘↵, ⌘\\, the queue) act on the focused pane. Put `data-focused` on the section so tests can check it.

**Widths and dividers**

- Every pane is at least **360px** wide, the side chat included (this replaces the side chat's earlier 320px minimum). There is no other maximum: a pane can grow until its neighbours reach 360px.
- A new pane gets an equal share, and the others shrink in proportion. Widths are remembered per number of panes, as fractions (`localStorage`, read in try/catch), so resizing the window keeps the proportions.
- Divider between two neighbouring panes: a 6px hit area with a 1px line `bg-[var(--glass-border)]`; on hover or drag the line becomes 2px `bg-[var(--glass-accent)]`; `cursor-col-resize`. Dragging resizes only those two panes. Double-click splits the two equally. `role="separator" aria-orientation="vertical" aria-label="Resize <left title> and <right title>"`, `aria-valuenow` = the left pane's share in %, `tabIndex=0`, arrow keys per 2.8.
- If the open panes can't each get 360px (the window shrank, or the sidebar was expanded), switch to the one-pane-at-a-time layout (3.8.4). A resize never closes a pane.

**The composer at 360px** (328px of content after `px-4`):

- Tray (2.1): quotes clamp to 2 lines, file chips get `max-w-full` with truncated names, and the height cap is unchanged.
- The button row holds +, the textarea, the mic, and Send (or Queue plus Stop). When they don't fit on one line, the existing wrap (`expanded`, `chatInput.tsx:229,334`) gives the textarea its own row. That's expected.
- Below `@xl` (576px of pane width) these are hidden, the same as on phones today: the hint text, the context circle, the folder picker (it stays reachable in Model settings, as on phones, `WorkingFolderPicker.tsx:12-13`), and the quote-card key hint. MinimapNavigator is hidden below `@2xl` (672px).
- With two or more panes, the composer hides its own ModelSelector, because the header's model chip replaces it.
- Inline cards wrap their footers (2.3). Bubbles keep `max-w-[85%]`.

**Pane states**

- **Loading**: the pane appears at once (its width animates in) with a skeleton. Build it from the bars in `c/[id]/loading.tsx` (`bg-zinc-800 rounded animate-pulse`, which flips in light mode), but with percentage widths (`w-1/2`, `w-2/3`, `w-3/4`), because that file's fixed `w-72`/`w-80` bars overflow a 360px pane. The skeleton is a title bar `h-4 w-1/2`, two chip bars `h-6 w-16`, four message bars on alternating sides, and a composer bar `h-12 rounded-[var(--glass-radius-xl)]`. Set `aria-busy="true"` on the section while loading. Don't use the full-page "Loading conversation..." card (`ConversationLayout.tsx:58-66`).
- **Empty chat**: EmptyState with a 32px icon. The tips line (2.9) shows only at `@lg` and up.
- **Not found** (deleted somewhere else, or a stale id in the URL): centred in the pane body, **This chat no longer exists** (`text-sm text-zinc-400`) with a **Close pane** button (`glass-button h-8`).
- **Load error**: **Couldn't load this chat**, with **Try again** (`glass-button-primary h-8`) and **Close pane** (`glass-button h-8`).

**Closing**

- ×: `X` 16px, `aria-label="Close <title>"`, title **Close pane** (on a side chat: **Close side chat (⌘\\)**). The last pane left has no ×.
- A **busy** pane (a reply running, or unsent text, quote cards, files or queued items) asks first, using the existing native `confirm()` pattern (`Sidebar.tsx:80`): **Close "<title>"? Its reply will stop and unsent text will be lost.** An idle pane closes without asking.
- Focus then goes to the left neighbour's textarea, else the right neighbour's.

**Accessibility**: the panes row is `role="group" aria-label="Split view"`. Each pane is a `region` named after its chat (a side chat: "Side chat: <title>") and keeps its own live region (2.5).

#### 3.8.2 Split view [P3]

**Opening a chat in split view.** There are three ways, and each opens the chat as a new pane:

1. **Drag** a chat from the sidebar onto the chat area (below).
2. The sidebar row menu (`Sidebar.tsx:392-431`), with a new first item **Open in split view** (12px `Columns2`, same row style). Right-click on a row opens the same menu, anchored to the row's … button (`preventDefault` on `contextmenu`). The new pane opens to the right of the focused pane.
3. The palette's Split view group (2.9).

Options 2 and 3 are the keyboard alternative to dragging. Both work without a mouse.

- A chat is never shown twice. If it's already open, its pane gets focus instead.
- At the pane limit (1.7: 3, 2 or 1 by window width), the menu item and the palette items are `aria-disabled`, with the tooltip and tap toast **Close a pane first. Up to <n> fit at this width.**
- In the one-pane-at-a-time layout (3.8.4), "Open in split view" is hidden.

**The sidebar in split view**

- Clicking a chat opens it **in the focused pane**, the same as today with one pane. If that chat is open in another pane, that pane gets focus instead. If the focused pane is busy, ask first: **Replace "<title>"? Its reply will stop and unsent text will be lost.**
- New Chat opens in the focused pane.
- Highlight: the focused pane's chat keeps today's `glass-strong` row (`Sidebar.tsx`).
- **On-screen mark.** With more than one listed pane open, every row whose chat is open in a pane shows a 14px `Columns2` mark, the focused one included: `text-zinc-200` on the focused row, `text-zinc-400` on the others. It is a `role="img"` with `aria-label` **Open in split view, pane <n> of <total>**, counting only listed chats (side chat panes are left out; `n` is the position from the left). It has no `title`: on hover the actions cover it. A single open chat shows no mark.
- A main chat whose side chat is open in a pane (side chats are not listed) shows the same mark with the label **Side chat open**, unless it is one of several listed panes, which wins. A main chat with only its side chat beside it is not a split, so it shows this label, not a pane number. When the side pane has focus, its main chat's row is the highlighted, focused one.
- The mark is absolutely positioned (`absolute right-3`, centred on the row, 22px box) over the slot the hover actions already reserve, so no row changes size when it appears or goes. On hover it fades out (`group-hover:opacity-0`, `pointer-events-none`) and the pin and … buttons take its place, so the two never overlap.

**The sidebar list: forks nested**

- A chat with `forkedFromId` whose parent is in the same rendered list sits **directly under its parent**, indented 20px per level (`marginLeft`) and tagged `data-depth` (0 for top level). Children are oldest first (`createdAt`). A fork of a fork nests again, up to depth 3; deeper forks stay at depth 3. Top-level rows keep the list's sort (pinned, then newest activity). No collapse: always expanded.
- A fork stays a normal top-level row when its parent is not in the rendered list (deleted, archived, hidden by the filter tab), when the fork is pinned and its parent is not (it stays with the pinned rows), and while a search is active (the list is flat).
- Lines: 1px `--glass-border-strong`, drawn per row as absolutely positioned spans, 12px left of the row, in a wrapper that is the row's border box (`-inset-px`), starting one row gap (0.25rem) above it so they join without gaps. A vertical line runs beside every row of the group; the last row's line stops at the row's middle and turns into the row with a `rounded-bl-lg` corner (└). A grandchild adds its parent's line when that parent has later siblings. They are `aria-hidden` and `pointer-events-none`.
- The grouping is the pure `buildSidebarTree` (`src/lib/sidebarTree.ts`); the list API returns `forkedFromId` for it. A `forkedFromId` cycle shows each chat once.
- Rows stay draggable, pinnable, archivable and renamable; nesting changes the order and indent only.

**Dragging and the drop zones**

- Drag source: the whole sidebar row (`draggable`; the inner `<Link draggable={false}>`). `dragstart` sets a custom type `application/x-devchat-chat` (the id) and `text/uri-list` (`/c/<id>`). Use the browser's default drag image.
- The overlay shows only while a drag of that type is over the panes area: `absolute inset-0 z-30` over the panes row, transparent, with no scrim, so the panes stay readable. Never over the sidebar, never for file drags. Close any open popover on `dragstart`.
- **Below the limit**: each pane splits into a left-half zone and a right-half zone. Dropping on a half opens the chat as a new pane on that side of that pane. With one pane open, that gives two zones (left, right).
- **At the limit (dropping a 4th pane)**: each pane is one whole zone, **Replace "<title>"**. A busy pane isn't a target: its zone is at `opacity-50`, `dropEffect = "none"`, labelled **Busy: replying or has a draft**. If every pane is busy, show one centred label instead: **Close a pane first. Up to <n> fit at this width.** A pane is only ever replaced when the user dropped onto that exact pane.
- **Chat already open**: no zones. One centred label, **Already open**. Dropping focuses its pane.
- Zone look. Idle: `m-2 rounded-[var(--glass-radius-lg)] border-2 border-dashed border-[var(--glass-border-strong)] bg-[var(--glass-bg)]`. Hovered: `border-[var(--glass-accent-strong)] bg-[var(--glass-bg-active)] shadow-[var(--glass-shadow-glow)]`. Only the hovered zone shows a label chip, centred: `inline-flex h-8 items-center gap-1.5 rounded-full glass-panel-strong px-3 text-xs font-medium text-[var(--foreground)]` with a 14px icon: `PanelLeft` **Open on the left**, `PanelRight` **Open on the right**, or `Replace` **Replace "<title>"**. Everything is built from tokens, so it works in both themes.
- Motion: per 1.5 (overlay 120ms, zones 100ms, the new pane's width 0.2s). Reduced motion makes all of it instant.
- **Drop**: the overlay goes away at once, the new pane animates in and its textarea gets focus. **Esc**, or dropping outside a zone (sidebar, a header), cancels and nothing changes.
- **Announcements**, in one page-level `aria-live="polite"` region outside the panes:
  - on entering the area: **Dragging "<title>". Drop on the left or right of a chat. Esc cancels.**
  - on entering a zone: the zone's label
  - on drop: **"<title>" opened. Pane 2 of 3.**
  - on cancel: **Cancelled**

**URL and reload**

- Opening, closing and replacing panes use `router.replace`, never `push`, so Back leaves the page instead of stepping through pane changes. The URL format is in the companion doc.
- A reload restores the same panes, order, widths and focused pane. A pane whose chat is gone shows the not-found state (3.8.1).

**Two writers on one folder**

- When two or more open panes are in **Ask or Agent** mode with the **same working folder** (not empty), each of them shows this item on header line 2: a 12px `AlertTriangle` (`text-amber-400`) and **Another open chat can edit this folder**.
- It's a button styled `inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-[var(--foreground)]`, with the tooltip **"<other title>" is in <Agent|Ask> mode on <short folder>. Click to go to it.** Clicking focuses the other pane (with three writers, the next one).
- Keep it calm: no banner, no red, no modal, and it never blocks sending. It goes away as soon as either pane changes mode or folder, or closes. Chat and Plan panes and side chats never count (they're read-only).
- Announce it once in each pane's live region when it appears.

**Pitfalls**

- The composer's file overlay starts on any drag that carries items (`chatInput.tsx:172`), so dragging a chat over a composer would show "Drop files to attach". Show it only when `e.dataTransfer.types.includes("Files")`.
- `dragover` must call `preventDefault()` over a valid zone, or `drop` never fires. Work out the zone from `clientX` in the overlay's `dragover`, not from enter/leave on each zone (those fire for every child).
- Don't reuse `DragOverlay.tsx`: it covers the whole screen at `z-50`, handles files only, and uses `text-white`.
- Each pane has its own chat state. Never share input, quote cards, queue or files between panes.

#### 3.8.3 Side chat [P3]

A side chat is a pane whose chat is a child of the pane next to it. It takes one pane slot, and 3.8.1 covers everything not listed here. It looks like a companion card, not a full chat.

- **Where**: next to its parent, on the right by default, or on the left when docked left. The side it opens on is the one it was last on. There is no dock button in the header.
- **Panel**: a floating card inset 8px from the pane edges, `rounded-[var(--glass-radius-lg)]`, with a 1px `--glass-border` and a background a touch lighter than the main pane (`--glass-bg-elevated`).
- **Width**: compact is about 400px when docked next to a main chat, never below 360px. The expand button makes it wide, half the row. Collapse returns it to compact. Dragging the divider still resizes it.
- **Open and close**: ⌘\ toggles the side chat of the focused pane's chat (if the focused pane is a side chat, it closes it). The same works from the palette or with `/side`. At the pane limit, show the toast **Close a pane first. Up to <n> fit at this width.**
- **Header**: one 48px row with `px-3`. On the left, a tab chip (32px, `glass-button`, at most 260px wide) shows the side chat's title, else its first message, else **Side chat**, truncated. Clicking the text opens **Older side chats**: rows show the title (or the first message, cut at 40 characters) and `getRelativeTime`; the current row has a 14px `Check`; empty: **No older side chats**. A 14px `X` inside the chip closes it (**Close side chat**). On the right, three 16px icon buttons in 32px squares: `Plus` **New side chat**, `Maximize2` / `Minimize2` **Expand side chat** / **Collapse side chat**, and `X` **Close side chat**, tooltip **Close side chat (⌘\)**. There is no mode chip, model picker, "Sees" line or dock button.
- **Messages**: a reply has no bubble. It is plain prose at full width, 15px with a 28px line height. The user's messages are right-aligned in a `bg-white/5` bubble, at most 85% wide. Tool calls and reasoning fold to one muted line (`text-sm text-zinc-500`): **Used <tool>: <short summary>**, or **Reasoning**, with a `ChevronRight`. Clicking it opens the full detail. A call that needs the user (an approval, a plan, a question, a sub-agent) stays a card.
- **Actions**: the row under the last reply is always visible; under the others it shows on hover. It has Copy, **Send to main** and a relative time (**19 hours ago**, from the message's time). Icons are 16px in `text-zinc-500`.
- **Empty state**: a 32px `PanelRight` icon (`text-zinc-400`), **Side chat**, and **Ask about "<parent title>". Nothing here is added to it.**
- **Send to main**: on each assistant reply, in its actions row, a labelled button with a 16px `ArrowLeftRight` and **Send to main** (an icon alone would be unclear). Tooltip: **Add to the message box of "<parent title>"**. For 1.5s after a click it shows `Check` and **Added**. It fills the parent's textarea and focuses it. In the one-at-a-time layout, it also switches to the parent pane.
- **Composer**: one rounded box inset 12px from the card edges (`rounded-[var(--glass-radius-lg)]`, 1px `--glass-border`, `bg-white/[0.03]`, `px-4 py-3`). The textarea grows up to 6 lines. Its placeholder is **Ask about "<parent title>"…** and its name is **Message**. On the right, a 28px `CornerDownLeft` button named **Send**. While a reply streams it becomes a `Square` button named **Stop**. Enter sends, Shift+Enter adds a line, and Enter during a reply queues the message, as in the main chat. No attachments, @ files, model picker, folder picker, mic or token ring. The side chat keeps its own saved model.
- **Quote from the main chat**: "Start a side chat" in the selection pill (3.1) or on a quote card puts a quote above the box. The side chat holds **one** quote; a new one replaces it. It sits inside the composer box, at its top: the box is one rounded container with the quote above the textarea (`border-l-2 border-zinc-600 pl-2 text-xs italic text-zinc-400`, clamped to 2 lines, with a 12px `X` at the right named **Remove quote**). Reply on a selection inside the side chat replaces this quote too. If the card it came from had an instruction, that text pre-fills the box. Sending (Enter or Send, even with no text typed) sends the quote in the same `> quoted` format as the main composer, then what was typed, and clears the quote. The box takes focus when the quote arrives.
- **Not in a side chat**: suggestions, the mode menu, Regenerate, Edit, Fork, Delete, feedback, **Send to another chat**, MinimapNavigator and TodoIndicator.
- **Sub-agent viewer**: opens as a read-only pane next to the parent in split view (3.11 "Open"). The title is **Sub-agent: <title>**, with a `Read-only` badge (`ArtifactReference.tsx:54` style). There's no composer; in its place a footer (`px-4 py-3 text-xs text-zinc-400 border-t border-[var(--glass-border)]`) reads **Read-only transcript**, or **Still running. The card in the main chat shows live steps.**
- **Open button**: main chats show a **Side chat** button in the header, right of the mode switch (`PanelRight` 16px + label, label hidden on small screens, `aria-pressed`, tooltip names ⌘\). It opens or closes this chat's side chat.
- **Focus**: opening via the header button, ⌘\, the palette or `/side` focuses the side textarea. Closing returns focus to the parent's textarea. `/side <question>` opens the side chat and sends the question there.
- Keep the parent's scroll position when the side chat opens, and stay pinned to the bottom if it was there. Two Stop buttons at once (one per pane) is correct.

#### 3.8.4 Narrow screens: one pane at a time

- **When**: below 768px, or whenever the open panes can't each get 360px. Nothing closes. Widening the window or collapsing the sidebar brings the panes back side by side.
- **Pick: a switcher, not tabs.**
  - A tab row costs a 40px strip on a phone, where the header, composer and keyboard already take most of the height.
  - Three tabs at 400px leave about 110px per title, which truncates to nothing.
  - The header already has a title slot that can become a button, and the menu pattern exists (2.4).
- **Switcher**: with two or more panes open, the visible pane's title becomes a button: the title, a count badge `1/3` (`text-[10px] font-semibold rounded glass px-1.5`, the `ArtifactReference.tsx:54` badge) and a 12px `ChevronDown`. Give it `aria-haspopup="menu"`, `aria-expanded`, and `aria-label="Switch chat, 1 of 3: <title>"`.
  - Menu rows: a 14px mode icon (`PanelRight` for a side chat), the title (a side chat reads **Side chat · <title>**), a 6px `bg-blue-400` dot with sr-only "replying" for panes that are replying, and a `Check` on the current pane. Then a separator and **Close this pane**.
- Choosing a pane shows it at once and focuses its textarea. Ctrl+\` cycles through panes. Hidden panes stay mounted with `hidden` (`display: none`), so their replies keep streaming.
- No dividers, no dock button, no drag and drop, no "Open in split view". The side chat is an ordinary pane here: there's no longer a `fixed inset-0 z-30` overlay. Its × goes back to the parent.
- With only one pane open: no switcher, and the normal `ConversationHeader`.

### 3.9 Fork from here [P3]

- **Action**: in MessageActions, on any saved message in a chat pane, a `GitFork` 12 button with `aria-label` and `title` **Fork from here**, placed after Copy. Hidden while streaming (existing rule, `MessageActions.tsx:84`) and in side chat panes. In split view the fork opens in the focused pane, like any sidebar click (3.8.2).
- **Click**: the icon swaps to a 12px `Loader2`. Then the new chat opens (its messages up to and including this one, titled "<title> (fork)") and appears in the sidebar directly under the original (3.8.2, forks nested). Error toast: **Couldn't fork this chat**.
- **Header of the fork**: the first item in the meta row is 12px `GitFork` plus **Forked from** and a link to the source (`text-xs text-zinc-400`; the title is a link, `hover:text-[var(--foreground)] hover:underline`, truncated at 200px). If the source is gone: **Forked from a deleted chat** (no link).
- Forking a temporary chat makes a normal, saved chat.

### 3.10 Modes, approval card, plan card [P4]

**Mode switch**: extend `MODES` in `ModeToggle.tsx:6-19` to four segments, in increasing order of power.

| Mode | Icon | Tooltip (`title`) | Composer placeholder |
|---|---|---|---|
| Chat | `MessageSquare` | Chat: answers, with read-only tools (web search, knowledge base, code run) | Type a message, / for commands, or drop files… (existing) |
| Plan | `ListChecks` | Plan: researches, then proposes a plan for you to approve. Changes nothing. | Describe the task. You'll get a plan to approve. |
| Ask | `ShieldQuestion` | Ask: can make changes, but asks before each one | Ask mode: changes need your OK |
| Agent | `Target` | Agent: makes changes without asking (artifacts, todos, memory, MCP, files) | Agent mode: can make changes without asking |

- Header: labels from `sm` up, icons only below. Sidebar compact toggle (`Sidebar.tsx:243`): **icons only** for all four (four labels don't fit in 256px).
- Keyboard: one tab stop (the checked segment). ←/→ move and select. Focus ring per 2.5.
- No tools (2.6): Chat and Plan work, Ask and Agent get `aria-disabled` with the 2.6 tooltip. If the chat is in Ask or Agent when the user picks a model without tools, switch to Chat with the info toast **Switched to Chat: <model> can't use tools**.
- Changing mode during a reply is allowed and applies to the next message. No copy needed.
- `/plan <task>` (`commands.ts:33-41`): once modes ship, change the description to **Switch to Plan mode and send this task** and make it do that. With no tools it keeps today's text transform. One "plan" concept, not two.

**Approval card** (Ask mode; also Claude Code file edits in Ask): an inline card, the "waiting" variant (2.3)

```
[ShieldQuestion amber] Needs your OK                                         Ask mode
Run a command                                            ← text-sm font-medium text-[var(--foreground)]
┌ the command, in full ─────────────────────────────┐   ← <pre> font-mono text-xs whitespace-pre-wrap break-all,
│ npm test -- --run                                 │     max-h-64 overflow-auto. Edits: the whole diff here,
└───────────────────────────────────────────────────┘     add lines bg-emerald-500/10, remove lines bg-red-500/10
Model's description: Run the tests                       ← text-xs text-zinc-400, only if the model sent one
  timeout   120000                                       ← every other key, uncut: label text-xs text-zinc-400 w-16,
  …                                                         value text-xs font-mono text-zinc-200, one scrollable area (max-h-64)
  › Show all arguments                                   ← toggles a full JSON <pre> (ToolInvocation body style)
                                  [Deny] [Allow for this chat] [Allow]
```

- The card never hides what will run. Nothing is cut at a length and no key is dropped; the model's key order does not matter.
  - **Bash**: `command` first, in full, in the scrollable block.
  - **Write**: the file path (muted) and the full `content` in the block. Write replaces a file that exists, so it is not worded as creating one.
  - **Edit**: the whole removed and added text as a diff. **MultiEdit**: every edit as a diff, headed **Edit n of N** when there are several.
  - The model's `description` sits below, labelled **Model's description:** in muted text: it is the model's claim, not what runs.
  - Every other key follows as a row, uncut, in one scrollable area.
- Title by tool: **Create artifact "<title>"**, **Update artifact "<title>"**, **Update the todo list**, **Save to memory: "<key>"**, **Run <tool> on <MCP server>**, **Edit <path>**, **Write file <path>**, **Run a command**, otherwise **Run <toolName>**.
- **Allow for this chat** only answers an Edit, Write, MultiEdit or NotebookEdit inside the chat's working folder and outside `.git/` and `.claude/`, and never one Claude Code raised for a protected path (it names a blocked path or a reason). Every other request still shows its card. Bash never auto-allows.
- Buttons, left to right: **Deny** (`glass-button`), **Allow for this chat** (`glass-button`, tooltip **Don't ask again for <tool> in this chat**), **Allow** (`glass-button-primary`). All `h-8`.
- After a decision the card collapses into the normal tool row (`ToolInvocation`). Its meta reads **Allowed**, **Allowed for this chat**, **Denied** (`XCircle text-zinc-400`, no output), or **Cancelled** (after Stop).
- Several approvals in one step: one card each, stacked. No "allow all".
- Never steal focus from the composer: the user may be typing a correction (it queues, 3.6). Announce **Needs your OK: <title>** once.
- Undo "Allow for this chat": the More menu item **Reset allowed tools** (`ShieldCheck` 14), shown only when the list isn't empty. Toast: **Ask mode will ask again**.
- Sub-agent in Ask mode: its approval card appears inside the sub-agent card's step list. The sub-agent card opens itself and its meta reads **Waiting for you**.

**Plan card** (Plan mode): an inline card, the "waiting" variant until decided

```
[ListChecks blue] Plan · <title>                                            6 steps
 1. Step text, text-sm                          ← <ol>, space-y-1.5; optional detail line text-xs text-zinc-400
 2. …                                             over 8 steps: show 8, then "Show all 14 steps"
Run in  [Ask | Agent]                                           [Revise] [Approve plan]
```

- "Run in" is a two-segment ModeToggle-style radio (`h-7 text-xs`) with **Ask** selected by default (the safer one). The label `Run in` is `text-xs text-zinc-400`.
- **Approve plan**: switches the chat to the chosen mode (the header updates), sends a visible user message **Approved. Run the plan.**, and the card becomes a resolved row: `CheckCircle2` and **Approved · running in Ask mode**.
- **Revise**: focuses the textarea and sets the placeholder to **Say what to change in the plan**. The mode stays Plan, and the meta reads **Revising**.
- When a newer plan card arrives, older ones lose their footer and read **Replaced by a newer plan**.
- No tools (2.6): there's no card. Under the last assistant reply in Plan mode, show a row `mt-2 flex items-center gap-2` with **Approve plan** (`glass-button-primary h-8`) and the caption **This model can't use tools, so it will write out the result.** (`text-xs text-zinc-400`). Clicking it switches to Chat and sends **Approved. Carry out the plan.**

### 3.11 Sub-agent card [P5]

An inline card (2.3), one per helper. Up to 3 stack with the normal `my-2` gap. No group wrapper.

```
[›] [status 14] <title>                          Step 4 · 1:12 · 3.2k tokens   [Open]
    <brief, one line, text-xs text-zinc-400 truncate>
    <latest text preview, one line, italic text-zinc-400 truncate>   (only while running)
```

- Meta: `Step <n> · <m:ss> · <compact tokens>`, using `Intl.NumberFormat(undefined, { notation: "compact" })`, `font-mono tabular-nums`, and elapsed time ticking every 1s.
- **Open**: a text button `inline-flex h-6 items-center gap-1 rounded-[var(--glass-radius-sm)] px-2 text-xs glass-button` with 12px `PanelRightOpen` and **Open**; tooltip **Open transcript next to this chat**. It opens the transcript as a read-only split pane next to the parent (3.8.3). At the pane limit, show the 3.8.3 toast.
- Expanded body: the steps, `max-h-60 overflow-y-auto`, following the newest step unless the user scrolled up. Each row is `flex gap-2 text-xs` with a 12px icon (`Search` web, `FileText` read, `Pencil` write, `Wrench` other), a label like **Read src/app/page.tsx** (`text-zinc-300 truncate`), and the duration (`ml-auto text-zinc-400 tabular-nums`).
- Terminal meta words: **Done**, **Stopped at the 15-step limit** (`CheckCircle2`, it still reported), **Failed: <short reason>**, **Timed out after 5 min**, **Stopped**. On error or timeout, the body opens itself to show partial notes.
- Follow-up (`messageAgent`): a new card titled **<title> · follow-up**.
- A11y: `role="group" aria-label="Sub-agent: <title>"`. Announce terminal states only.
- Pitfall: the meta must not change width every second. Use `tabular-nums` and `shrink-0`, and truncate the title instead.

### 3.12 Agents messaging [P6]

- **Badge on a message from another agent** (user role, right-aligned): not the blue user style. Use `glass-card text-[var(--foreground)]` with the bubble's radius and padding, and above the text a badge row `mb-1 inline-flex items-center gap-1 text-[11px] font-medium text-zinc-400` with 12px `Bot` and **From "<sender pane title>"** (an untitled side chat reads **From side chat**; sub-agent follow-ups: **From the main chat's assistant**). Cut the title at 32 characters with `…`; the full title goes in `title`. So users never mistake it for something they wrote. Delivered mid-reply, it splits the reply the same way as 3.6, with this neutral style.
- **Any open pane can be the target** (split panes and side chats). The model only sees open panes.
- **Talking indicator**: a status row at the top of the tray (2.1) in **the two panes in the exchange** (other panes show nothing). `flex items-center gap-2 text-xs text-zinc-400`, then the `TypingIndicator` dots (compact), then **Talking with "<other pane title>" · 2 of 3**, then on the right **Stop** (`glass-button-danger h-7 px-2.5 text-xs`, same text colour as the existing Stop). Stop stops both panes and drops pending agent messages. The row disappears when the exchange ends or hits 3. In the one-at-a-time layout (3.8.4), the switcher's "replying" dots show the hidden pane's activity.
- **Queued while busy**: the receiver's queue shows it as an agent item (3.6), with the prefix **From "<title>":**.
- A message to a closed side chat opens it (focus doesn't move). Split panes that aren't open can't be messaged.

### 3.13 Workflows [P7]

`docs/design/workflows.md` section 8 owns the screens (list, editor, config panel, runs drawer) and their copy. The rules here apply to them unchanged:

- Glass tokens only (`glass-card`, `glass-input`, `glass-button*`, `glass-panel*`, `glass-nav`), no hex, no new colours. Text is `text-zinc-400` or stronger.
- Run status always shows the icon **and** its word (Not run, Running, Done, Failed, Skipped, Waiting for you, Cancelled, Interrupted). Colour goes on the 14px icon only.
- Check the list and the editor at 400px: no horizontal scroll, the editor shows the read-only list view, and Run, Cancel run and Resume still work.
- Every new control has the focus ring (2.5); icon buttons have `aria-label` and `title`. One `aria-live="polite"` region announces only Run started, done, failed, cancelled and waiting, and the describe box's build messages below.

**New workflow menu, Explain templates** (`workflows/page.tsx`):

- "Explain a GitHub repo" and "Explain a project folder" come last, after the other entries, in that order. Same row style as the others: label, then one description line in `text-zinc-400`.
- The folder entry shows a small "Local" pill (`border-[var(--glass-border)]`, `text-zinc-400`) beside its label and starts its description "Local only." Where command-line models can't be used (Vercel, or not the server's owner) it is a disabled menu item at 60% opacity whose description says why ("Not available here: it needs Claude Code or OpenCode on the server's own machine."). A disabled item shows no hover and no pointer.
- The two checks on that template read "Pick a Claude Code or OpenCode model" and "Pick the project folder" (the folder one appears once a command-line model is picked, because the folder field only exists for those models).
- A chat message posted by a workflow is drawn as markdown (headings, lists, code, mermaid diagrams with the Show code and Copy toolbar), inside the same neutral "From <workflow>" card. Each link in it shows its host after the text, in `text-xs text-zinc-400` ("View diagram (evil.example)"; see workflows.md 10.5). The menu item stays disabled until the server has said command-line models are available.

**Describe your flow** (`DescribeBox.tsx`, workflows 7):

- The box is a `glass-card` strip above the cards, in the Canvas and List views. It is open on a workflow with only the trigger (the empty state, larger, with the heading "Describe what you want done and DevChat lays out the cards") and a collapsed "Describe your flow" button otherwise. Under 768px it is not shown: the editor is read-only there, so there is nothing to apply.
- Keyboard: **Enter builds, Shift+Enter adds a line**, Esc anywhere in the box cancels a request in progress. Cmd/Ctrl+Enter inside the box does nothing (it is not Run). The hint "Enter builds · Shift+Enter adds a line" sits next to the model picker.
- While building, the one button turns into **Cancel** (same element, so focus stays), the text becomes read-only, a spinner and "Building your flow…" show, and the cards, Run and Workflow settings are read-only, so nothing is edited under the request. Cancel, Esc, and leaving the page abort it; the typed text stays. The box stays open until the answer.
- An error shows in a row under the box: a red icon, the word "Failed." and the server's plain message, with **Retry** (`aria-describedby` points at the message). Focus moves to Retry, and back to the text box when Retry is pressed. The 409, 422, 502, 504 and 403 messages come from the route; a dropped connection says "Couldn't reach the server."
- The preview bar ("Preview · 4 cards · Nothing is saved until you apply it." with **Apply** and **Discard**) replaces the box. Focus goes to Apply; Esc inside the bar discards. Warnings list under "Check before you run" with an amber icon and that heading as the word. Apply keeps the current variable values and the variables the proposal lacks, checks the flow against the save rules (a refusal is a toast and the preview stays), asks `confirm("Replace the current flow?")` only when the flow has cards, then saves through the editor's normal autosave. After Apply or Discard, focus goes to the editor area. Run is `aria-disabled` while a preview shows. A past run (`?run=`) never shows a preview.
- The proposed cards use dashed borders (`.wf-preview` in `canvas.css`), are not selectable or editable (in the List view they are plain, not buttons), and show "Not run". There is no extra live region: "Building your flow…" (cleared when the build ends), "Preview ready: n cards", "Flow applied" and "Preview discarded" go through the editor's one polite region.

**Google Sheets sync** (workflows phase 7):

- The table header reads, left to right, **Open sheet** (only once a sheet exists, opens in a new tab with `rel="noopener noreferrer"`), **Sync to Google Sheets** and **Export CSV**, all 36px `glass-button`s that wrap on a narrow screen. Pressing Sync when Google is not connected goes to Google and returns to the table, where the sync finishes by itself; the `?google=` and `?sync=` flags are removed from the address afterwards. While it runs the button says "Syncing…" and is `aria-disabled` (not `disabled`, so focus stays on it) with a guard against a second press. Done is a toast, "Synced 3 rows to Google Sheets".
- When Google refuses the saved access, the Sync button is replaced by a primary **Reconnect Google** link (also on later visits) and the toast says "Google access ended. Reconnect Google, then try again." No raw Google error, stack or token is ever shown.
- Settings has a "Google Sheets" card with one line of state ("Google isn't connected.", "Google is connected. DevChat can only open the sheets it creates.", "Google access ended.") and one button: **Connect Google**, **Reconnect Google** or **Disconnect**. If the state cannot be read, the line says "Couldn't check the Google connection." with Connect Google. A `?google=` result flag is shown once as a toast and then removed from the address. The card's own settings show the same state in one line, with a link to Settings, so connecting never leaves unsaved card edits behind.

**Waiting for you and pick mode** (Pick rows, workflows 3):

- A run that waits shows a `glass-card border-amber-900/50` banner under the header (the amber border of 2.3: this card needs the user): `ShieldQuestion text-amber-400`, "Waiting for you: pick rows in “<table>”, then continue.", **Open table** (the one primary button) and **Cancel run**. While the banner shows, the header's Cancel run is hidden, so there is one Cancel run on the page. The banner does not move focus and has no live region of its own: "Run waiting for you" goes through the editor's one polite region. It stays after a reload and comes back whenever the run is waiting.
- The table's pick mode (`/tables/<id>?pick=<runId>`) puts the same kind of banner above the toolbar: "Pick up to 10 rows for “Draft application”, then continue.", a "3 picked" count (with " · Up to 10" at the limit), a secondary **Continue with none** and a primary **Continue run (3)**. Continue run is `disabled` at 0 picked; Continue with none is the way to continue with nothing. The grid shows only the statuses on offer, with the line "Showing rows with status new" and **Show all rows**; rows that are not on offer have a disabled checkbox. There is no select-all, no bulk status change and no Delete in pick mode. A tick over the limit is refused with the toast "Up to 10". **Continue with none** with rows ticked asks `confirm("Continue without the 2 ticked rows?")`, so ticks are never dropped silently.
- Pick mode on a run that is no longer waiting says "That run is not waiting for rows from this table any more." with a link back, and shows no banner.
- Pick mode at 400px: the banner wraps (buttons under the text), the grid scrolls inside its own container, and the page itself never scrolls sideways.

---

## 4. Compatibility at a glance

`toolsAvailable` comes from 2.6. "Same" means the same UI with every model.

| Feature | Tools available | No tools (older, small or local models) |
|---|---|---|
| Quote-reply, export, `/compress`, temporary, fork, side chat, split view, @ files | same | same (@ files may show the trimmed note) |
| Search past chats | model calls `searchChats`; `/recall` also works | `/recall` only; same card |
| Queue | delivered between steps; hint "the model sees it at its next step" | sent after the reply; hint "sends when the reply finishes" |
| Modes | all four | Chat; Plan via an "Approve plan" button; Ask and Agent `aria-disabled` with the tooltip |
| Approval card | yes (Ask) | n/a (Ask disabled) |
| Sub-agent | model-started cards | hidden (never offered) |
| Agents messaging | `sendToChat`; badges and talking row | hidden; "Send to main" still works |

---

## 5. UX review checklist

Tick per feature, from screenshots in light and dark, at desktop width and about 400px.

- [ ] 1. Only existing `glass*` classes, tokens and zinc and status colours; no new hex/rgb, CSS variables or UI libraries.
- [ ] 2. Readable in both themes: no `text-white` outside primary surfaces, no coloured body text, no new `zinc-500`/`zinc-600` text.
- [ ] 3. Every status pairs an icon with a word; nothing relies on colour or a spinner alone.
- [ ] 4. Copy matches this doc word for word: sentence case, `…`, "chat", no "Please" or "!".
- [ ] 5. Icon-only buttons have `aria-label` and `title`; titles include the shortcut where one exists.
- [ ] 6. Tabbing shows the focus ring on every new control; the segmented controls use arrow keys.
- [ ] 7. Focus lands where the feature section says on open, close, send and remove; never on `<body>`.
- [ ] 8. Esc follows 2.8; Enter, Shift+Enter and ⌘Enter in the main input behave as before.
- [ ] 9. Loading, empty, error and disabled states exist and are screenshotted.
- [ ] 10. Tray order is status, queued, quotes, files; it caps at `min(30dvh,240px)` and scrolls; the textarea still caps at 200px.
- [ ] 11. With three cards at 400×700, the transcript still shows at least 160px.
- [ ] 12. No layout jump: tray items animate their height, live numbers use `tabular-nums`, card headers keep their height across states.
- [ ] 13. With reduced motion on, transforms are off (`MotionConfig`) and nothing important depends on motion.
- [ ] 14. At 400px: no horizontal scroll, nothing clipped, footers wrap, touch targets at least 32px.
- [ ] 15. Menus aren't covered by transcript elements or other panes; overlay panels cover every pane; the drop overlay sits above pane headers but below the mobile sidebar and overlay panels.
- [ ] 16. Model without tools: the fallback replaces the control, or it's `aria-disabled` with the tooltip (and a toast on tap); nothing dead, nothing silently missing.
- [ ] 17. Tray items: × always visible with an `aria-label`; containers are lists; one item shape for quotes and queue, `AttachmentChip` for files.
- [ ] 18. Inline cards follow 2.3: header, body, footer; primary button last on the right; waiting cards get the amber border.
- [ ] 19. Reply pill: only for single-message selections; never in the composer, cards or dialogs; doesn't clear the selection on click; code-block and card chrome stay out of the quote.
- [ ] 20. Side chat: it sits next to its parent and takes one slot; dock left/right works; ⌘\\ toggles; "Send to main" fills and focuses the parent's input.
- [ ] 21. Temporary chat: dashed composer, header meta note and empty state all show; not in the sidebar or search; Memory item disabled.
- [ ] 22. Approval and plan: no focus stolen; Deny and Revise equally reachable; resolved state collapses to one row.
- [ ] 23. Sub-agent card: live meta doesn't jitter; terminal states are correct; Open shows the read-only transcript.
- [ ] 24. The screen reader live region announces quote added, queued, delivered, needs your OK, plan ready and sub-agent finished, each once.
- [ ] 25. Discoverability: a palette entry, a `/help` listing and a shortcuts-dialog row exist where the feature has one; existing composer controls (plus menu, voice, model, folder, context circle) look and work as before.
- [ ] 26. Panes: with two or more open, every pane uses the compact header (title, mode chip, model chip, ×). Only the focused pane has a full-colour title and a stronger composer border. ⌘Enter and Ctrl+\` act on or move between panes.
- [ ] 27. Pane widths: no pane is under 360px; dividers resize two neighbours and work with arrow keys; widths and open panes survive a reload; a resize below the limit switches to the switcher and never closes a pane.
- [ ] 28. A 360px pane at 1440px wide: the composer, tray, header line 2 and inline cards fit with no clipping, and the container-query rules hide the hint, context circle and folder picker.
- [ ] 29. Drag and drop: half-pane zones below the limit; whole-pane "Replace" zones at the limit; busy panes refused; "Already open" focuses; Esc cancels; no file overlay during a chat drag; announcements fire. Menu and palette work without a mouse.
- [ ] 30. Narrow (400px) with two or more panes: the switcher shows 1/n with "replying" dots and switches instantly; hidden panes keep streaming. The two-writer warning shows in both panes, stays calm, and focuses the other pane on click. Skeleton, not-found and error states fit the pane.

### Diagrams in chat

A closed ` ```mermaid ` fence in an assistant message is drawn as an SVG in a glass card (`MermaidBlock`); user messages are plain text, so they show the fence as typed. Toolbar: a button whose label changes between "Show code" and "Show diagram" (no `aria-pressed`, the label says the state) and Copy (copies the source; "Couldn't copy" toast if the clipboard refuses). Both buttons have the 2.5 focus ring. The diagram has `role="img"` and an `aria-label` such as "Flowchart diagram". It scales down to the message width, so a wide diagram shrinks to fit rather than scrolling. While the reply streams, an unclosed fence (also inside a list item or quote) stays a normal code block, so a half-written diagram never shows an error. A parse error shows the code block plus one plain line: "Couldn't draw this diagram." and the parser's "Parse error on line N" and "Expecting ..." text. Mermaid runs with `securityLevel: "strict"`, forms, inputs, buttons, links and image maps are removed from labels, and `%%{init}%%` cannot change the security level, `themeCSS` or the fonts. It loads lazily and follows the app theme; drawings are cached by source, theme and level. The artifact viewer uses the same renderer. "Open larger" is not offered: the artifact viewer opens saved artifacts by id, not raw source.
