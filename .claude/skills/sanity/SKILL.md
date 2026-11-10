---
name: sanity
description: Run DevChat's sanity regression suite (typecheck, eslint on changed files, vitest, next build, Playwright functional and visual checks) and diagnose failures. Use after any change or new feature, when asked "did I break anything", or when the user says /sanity.
---

# /sanity

Runs `npm run sanity` and explains what broke. Suite docs: `e2e/README.md`.

## 1. Run it

- Default: `npm run sanity` (full, includes `next build`).
- If the user asks for quick, or only wants to iterate: `npm run sanity -- --quick`.
- Only Playwright, one spec: `npm run sanity -- --e2e e2e/<name>.spec.ts` (extra args go to Playwright, e.g. `-g "Stop"`).
- Accept the current lint errors as the baseline (after fixing what you can): `npm run sanity -- --update-lint-baseline`. It rewrites `scripts/eslint-baseline.json` from `src/` and `e2e/`, then runs only the eslint step. Do not run it to hide new errors.
- It stops at the first failing step. If it says port 3210 is in use, stop whatever listens there and re-run; do not work around it.
- Never point it at the dev database; the suite only ever uses `prisma/sanity.db`.

Report the summary table (step, result, time) to the user.

## 2. If a step failed

- typecheck, eslint, vitest, build: read the printed errors. Eslint only covers files changed vs `main`, with `--quiet`, and fails only a file with more errors than its entry in `scripts/eslint-baseline.json` (the printed messages are that file's errors).
- Playwright: for each failing test, in this order:
  1. Read the failure text from the run output. `npm run sanity:ui` opens the HTML report; the same data is in `playwright-report/` and `test-results/<test>/` (`error-context.md`, `trace.zip`, `*-actual.png`, `*-diff.png`). Look at the screenshot images; for a trace, `npx playwright show-trace test-results/<test>/trace.zip`.
  2. Read `git diff main...HEAD` (and `git diff` for uncommitted work) and find the change that touches what the test exercises.
  3. Name the likely cause for each failure in one or two lines: the test, what it expected vs saw, the file and change in the diff that explains it. Separate a real regression from a spec that needs updating because the feature changed on purpose.
- Visual diff: if the new look is intended, tell the user to run `npm run sanity -- --update`, review the new images, and commit them. If not, name the CSS or markup change that caused it.
- `test.fail(… known bug)` specs: if one now fails with "expected to fail but passed", the bug was fixed. Remove that `test.fail` line.
- Flaky? A test that passes on retry is reported as flaky. Do not hide it; say which one and why it might race (see Gotchas in `e2e/README.md`).

## 3. UI changes: offer a browser pass

When the diff touches UI (`src/app/**/*.tsx`, `globals.css`), offer a short browser pass of the touched areas against `docs/design/ux-guidelines.md` section 5 (the review checklist: light and dark, 1280px and about 400px, no horizontal scroll, existing `glass*` classes and tokens, readable text colours, `aria-label` and `title` on icon-only buttons, focus ring, empty/loading/error states). The suite's screenshots cover only four screens, so name which checklist items the pass would add. Ask first; start the app with `npm run dev`, or use the suite's server (`SANITY_TEST_AUTH=1`, DB `prisma/sanity.db`, see `playwright.config.ts`) if mock models are handy.

## 4. Remind the author

Every new feature must add its own `e2e/<feature>.spec.ts` before it is done, and "a feature isn't done until its sanity spec passes". If the diff adds a feature and `git diff main...HEAD --stat` shows no new spec under `e2e/`, say so.
