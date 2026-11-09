// `npm run sanity`: did the latest change break anything? Runs each step in order, stops on the first failure.
// Flags: --quick (skip the build)  --live (also run @live specs)  --update (update visual baselines)  --e2e (DB reset + Playwright only)
// --update-lint-baseline rewrites scripts/eslint-baseline.json from src/ and e2e/, then runs only the lint step.
// Anything else is passed to Playwright, e.g. `npm run sanity -- --e2e -g "Stop"`.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.SANITY_PORT ?? 3210); // must match playwright.config.ts
const SANITY_DB = path.join(root, "prisma", "sanity.db");
const LINT_BASELINE = path.join(root, "scripts", "eslint-baseline.json");

const flags = new Set(["--quick", "--live", "--update", "--e2e", "--update-lint-baseline"]);
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const lintOnly = has("--update-lint-baseline");
const passthrough = argv.filter((a) => !flags.has(a));

// Next's dist dir for the suite (must match playwright.config.ts). It gets deleted below, so refuse anything but a
// plain `.next-sanity…` folder name: "", "." and ".." would resolve to the repo itself.
const DIST = process.env.SANITY_DIST_DIR_OVERRIDE || ".next-sanity";
if (!/^\.next-sanity[\w-]*$/.test(DIST)) {
  console.error(`SANITY_DIST_DIR_OVERRIDE must look like ".next-sanity-3215", got "${DIST}". Nothing was touched.`);
  process.exit(1);
}

const run = (cmd, args, env = process.env) =>
  spawnSync(cmd, args, { cwd: root, stdio: "inherit", env }).status === 0;

const capture = (args) => {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
};

function changedLintTargets() {
  const base = capture(["merge-base", "main", "HEAD"]) ?? capture(["merge-base", "origin/main", "HEAD"]);
  if (!base) throw new Error("no `main` branch to compare against");
  const changed = capture(["diff", "--name-only", "--diff-filter=ACMR", base]) ?? "";
  const untracked = capture(["ls-files", "--others", "--exclude-standard"]) ?? "";
  return [...new Set(`${changed}\n${untracked}`.split("\n"))].filter(
    (f) => /\.(m?[jt]sx?|cjs)$/.test(f) && existsSync(path.join(root, f)),
  );
}

// eslint --format json; paths come back relative to the repo with forward slashes, as git prints them.
function eslintJson(targets) {
  const r = spawnSync("npx", ["eslint", "--quiet", "--format", "json", ...targets], { cwd: root, encoding: "utf8" });
  if (!r.stdout) throw new Error(`eslint printed no JSON: ${r.stderr}`);
  return JSON.parse(r.stdout).map((f) => ({
    file: path.relative(root, f.filePath).split(path.sep).join("/"),
    errors: f.errorCount,
    messages: f.messages,
  }));
}

function updateLintBaseline() {
  const rows = eslintJson(["src", "e2e"]).filter((r) => r.errors > 0).sort((a, b) => a.file.localeCompare(b.file));
  writeFileSync(LINT_BASELINE, JSON.stringify(Object.fromEntries(rows.map((r) => [r.file, r.errors])), null, 2) + "\n");
  console.log(`wrote ${rows.length} file(s) with lint errors to scripts/eslint-baseline.json`);
}

// Fails only a changed file that has more errors than its baseline entry (missing = 0).
function lint() {
  if (lintOnly) updateLintBaseline();
  const files = changedLintTargets();
  if (files.length === 0) {
    console.log("no changed JS/TS files vs main");
    return true;
  }
  const baseline = existsSync(LINT_BASELINE) ? JSON.parse(readFileSync(LINT_BASELINE, "utf8")) : {};
  console.log(`eslint --quiet on ${files.length} changed file(s), against scripts/eslint-baseline.json`);
  const offenders = eslintJson(files).filter((r) => r.errors > (baseline[r.file] ?? 0));
  for (const r of offenders) {
    console.log(`\n${r.file}: ${r.errors} error(s), baseline ${baseline[r.file] ?? 0}`);
    for (const m of r.messages) console.log(`  ${m.line}:${m.column}  ${m.message.split("\n")[0]}  ${m.ruleId ?? ""}`);
  }
  if (offenders.length > 0) console.log(`\n${offenders.length} file(s) have new lint errors. Fix them; only --update-lint-baseline rewrites the baseline.`);
  return offenders.length === 0;
}

// The ONLY database this suite may touch. The server and the CLI both get it explicitly.
function resetTestDb() {
  const env = { ...process.env, DATABASE_URL: `file:${SANITY_DB}` };
  for (const suffix of ["", "-journal", "-wal", "-shm"]) rmSync(SANITY_DB + suffix, { force: true });
  if (!existsSync(path.join(root, "node_modules/.prisma/client/index.js"))) {
    if (!run("npx", ["prisma", "generate"], env)) return false;
  }
  return run("npx", ["prisma", "migrate", "deploy"], env);
}

function portInUse() {
  return new Promise((resolve) => {
    const s = net.connect({ port: PORT, host: "127.0.0.1" });
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
  });
}

function playwright() {
  const args = ["playwright", "test", ...passthrough];
  if (has("--update")) args.push("--update-snapshots=changed");
  return run("npx", args, { ...process.env, SANITY_LIVE: has("--live") ? "1" : "" });
}

const steps = [
  { name: "typecheck", run: () => run("npx", ["tsc", "--noEmit", "-p", "."]), skip: has("--e2e") },
  { name: "eslint (changed files)", run: lint, skip: has("--e2e") },
  { name: "vitest", run: () => run("npx", ["vitest", "run"]), skip: has("--e2e") },
  { name: "next build", run: () => run("npx", ["next", "build"]), skip: has("--e2e") || has("--quick") },
  { name: "reset test DB", run: resetTestDb },
  { name: "playwright", run: playwright },
];

// A leftover server on the port could run stale code against a DB we are about to rebuild.
if (!lintOnly && (await portInUse())) {
  console.error(`Port ${PORT} is already in use. Stop that server (it may be an old sanity server) and re-run.`);
  process.exit(1);
}

// Next writes route types into the dist dir that `tsc` also reads; stale ones from another branch fail the typecheck.
if (!has("--e2e") && !lintOnly) rmSync(path.join(root, DIST), { recursive: true, force: true });

const results = [];
for (const step of steps) {
  if (step.skip || (lintOnly && !step.name.startsWith("eslint"))) {
    results.push({ name: step.name, status: "skipped", secs: 0 });
    continue;
  }
  console.log(`\n=== ${step.name} ===`);
  const t0 = Date.now();
  let ok = false;
  try {
    ok = await step.run();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
  }
  results.push({ name: step.name, status: ok ? "pass" : "FAIL", secs: (Date.now() - t0) / 1000 });
  if (!ok) break;
}

console.log("\n=== sanity summary ===");
const width = Math.max(...steps.map((s) => s.name.length));
for (const r of results) console.log(`${r.name.padEnd(width)}  ${r.status.padEnd(7)}  ${r.secs.toFixed(1)}s`);
const failed = results.find((r) => r.status === "FAIL");
for (const s of steps.slice(results.length)) console.log(`${s.name.padEnd(width)}  not run`);
const total = results.reduce((n, r) => n + r.secs, 0);
console.log(`total ${total.toFixed(1)}s`);
if (failed) {
  console.log(`\nFAILED at "${failed.name}". For Playwright failures: npm run sanity:ui (report + traces).`);
  process.exit(1);
}
console.log("\nAll sanity checks passed.");
