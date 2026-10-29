# Sanity suite

One command to find out whether a change broke anything, in behaviour or in looks.

```bash
npm run sanity            # typecheck, eslint (changed files), vitest, next build, Playwright
npm run sanity -- --quick # same, without the build
npm run sanity -- --live  # also runs the @live specs against local Ollama (skipped if it is down)
npm run sanity -- --update   # accept the current screenshots as the new visual baselines
npm run sanity -- --update-lint-baseline   # rewrite scripts/eslint-baseline.json (lint errors per file in src/ and e2e/), then run only the lint step
npm run sanity -- --e2e -g "Stop"   # only reset the DB and run Playwright; extra args go to Playwright
npm run sanity:ui         # open the last Playwright report (traces, screenshots, diffs)
```

It stops at the first failing step and prints a step / result / time table.

The eslint step lints the files changed vs `main` and fails only when a file has more errors than its entry in `scripts/eslint-baseline.json` (a file not listed counts as 0). Fixing old errors does not lower the baseline by itself; run `--update-lint-baseline` to tighten it.

## What it runs against

- A dev server on **port 3210** (not 3000/3001), started by `playwright.config.ts`. If something already listens there, `npm run sanity` refuses to start, because a stale server would test old code.
- A throwaway SQLite file, `prisma/sanity.db`, rebuilt from the migrations on every run. Your dev database is never used.
- A fixed test user and mock models. Both exist **only** when `NODE_ENV` is not `production`, `SANITY_TEST_AUTH=1`, and `DATABASE_URL` is `file:…/sanity.db` (see `src/lib/sanityMode.ts`).
  - Login: the "Sign in as test user" button on `/login`.
  - Models: `mock/echo` (replies with your prompt), `mock/slow` (about 7 s of chunks, for Stop), `mock/tool` (calls the calculator, then answers), `mock/notools` (no tool support), `mock/summary` (used by `/compress`).

## Adding a spec

Every new feature adds its own `e2e/<feature>.spec.ts` before it is done.

1. Create the file, one per feature area. Use the helpers in `helpers.ts`: `createChat` (API, fast), `openChat`, `send`, `storedMessages`.
2. Build state through the API, drive the feature through the UI, then check both what the user sees and what the server stored.
3. Need a new scripted reply? Add it to `src/lib/mockModels.ts` (keep replies over 30 characters; the chat route retries shorter ones).
4. Run just your spec: `npm run sanity -- --e2e e2e/<feature>.spec.ts`.
5. For a new screen, add it to `visual.spec.ts` (both themes run at 1280px and 400px) and generate its baselines (below).

Gotchas:

- In dev, React Strict Mode loads a page's data twice and the second load overwrites the first. After `goto`, wait for `networkidle` before typing or selecting (`openChat` does). Otherwise you lose messages in the test, not in real use.
- A message you just sent is saved under its client-made id, so edit and delete of it persist at once. Mark a known bug with `test.fail(…known bug)`; when it is fixed, `test.fail` starts complaining and should become `test`.

## Visual baselines

Screenshots live in `e2e/__screenshots__/` and are committed. They are per platform (`-darwin` here), so regenerate on the machine that runs them.

- A visual failure means the page looks different. Open `npm run sanity:ui` to see expected, actual and diff.
- If the change is intended: `npm run sanity -- --update`, look at the new images, commit them with the feature.
- Timestamps and the context-usage ring are masked.

## The rule

**A feature isn't done until its sanity spec passes.** Run `npm run sanity` (the full one, with the build) before you call it done.
