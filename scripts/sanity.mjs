// `npm run sanity`: did the latest change break anything? Runs each step in order, stops on the first failure.
// Flags: --quick (skip the build)  --live (also run @live specs)  --update (update visual baselines)  --e2e (DB reset + Playwright only)
// Anything else is passed to Playwright, e.g. `npm run sanity -- --e2e -g "Stop"`.
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3210;
const SANITY_DB = path.join(root, "prisma", "sanity.db");

const flags = new Set(["--quick", "--live", "--update", "--e2e"]);
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const passthrough = argv.filter((a) => !flags.has(a));

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

function lint() {
  const files = changedLintTargets();
  if (files.length === 0) {
    console.log("no changed JS/TS files vs main");
    return true;
  }
  console.log(`eslint --quiet on ${files.length} changed file(s)`);
  return run("npx", ["eslint", "--quiet", ...files]);
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
if (await portInUse()) {
  console.error(`Port ${PORT} is already in use. Stop that server (it may be an old sanity server) and re-run.`);
  process.exit(1);
}

// Next writes route types into the dist dir that `tsc` also reads; stale ones from another branch fail the typecheck.
if (!has("--e2e")) rmSync(path.join(root, ".next-sanity"), { recursive: true, force: true });

const results = [];
for (const step of steps) {
  if (step.skip) {
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
