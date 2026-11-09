import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { ENV_ALIASES, PROVIDERS } from "./src/lib/providers";

// SANITY_PORT lets suites in separate worktrees run side by side.
const PORT = Number(process.env.SANITY_PORT ?? 3210);
// Loopback only: this server has the no-password test login, so it must not be reachable from the network.
const HOST = "127.0.0.1";
const live = process.env.SANITY_LIVE === "1";
// Every env var that can make a provider look configured. Blank beats .env files: Next keeps a var set to "".
const providerEnv = Object.fromEntries(
  [...PROVIDERS.flatMap((p) => [p.envKey, p.envBaseUrl]), ...Object.keys(ENV_ALIASES)]
    .filter((name): name is string => Boolean(name))
    .map((name) => [name, ""]),
);
const storageState = path.join(__dirname, "e2e/.auth/user.json");
// An absolute path keeps Prisma from resolving it against the schema folder, and keeps dev.db out of reach.
// SANITY_DIST_DIR_OVERRIDE lets suites in separate worktrees (or beside a stuck server) use their own Next dist dir.
const DIST = process.env.SANITY_DIST_DIR_OVERRIDE ?? ".next-sanity";
const DB_URL = `file:${path.join(__dirname, "prisma/sanity.db")}`;

export default defineConfig({
  testDir: "e2e",
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{-platform}{ext}",
  // One shared DB and one fixed user, so specs run one at a time.
  workers: 1,
  retries: 1,
  timeout: 60_000,
  grepInvert: live ? undefined : /@live/,
  reporter: [["list"], ["html", { open: "never" }]],
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.01 },
  },
  use: {
    baseURL: `http://${HOST}:${PORT}`,
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "desktop",
      testIgnore: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, storageState },
      dependencies: ["setup"],
    },
    {
      name: "mobile",
      testMatch: /visual\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 400, height: 800 }, storageState },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: `npx next dev --hostname ${HOST} --port ${PORT}`,
    url: `http://${HOST}:${PORT}/login`,
    reuseExistingServer: true,
    timeout: 180_000,
    // The app logs every failed Ollama lookup (expected here); SANITY_DEBUG=1 shows the server log.
    stdout: process.env.SANITY_DEBUG ? "pipe" : "ignore",
    stderr: process.env.SANITY_DEBUG ? "pipe" : "ignore",
    env: {
      // Playwright sets NODE_ENV=test for itself; the server must run as dev (never production).
      NODE_ENV: "development",
      SANITY_TEST_AUTH: "1",
      // Working folder for the @ files spec (a stand-in for a Claude Code project).
      SANITY_WORKING_FOLDER: path.join(__dirname, "e2e/fixtures/project"),
      DATABASE_URL: DB_URL,
      SANITY_DIST_DIR: DIST,
      AUTH_SECRET: "sanity-suite-secret-not-a-real-secret",
      AUTH_TRUST_HOST: "true",
      GOOGLE_OAUTH_CLIENT_ID: "sanity",
      GOOGLE_OAUTH_CLIENT_SECRET: "sanity",
      // Blank values stop a developer's .env.local from reaching real providers (--live keeps its keys).
      ...(live ? {} : providerEnv),
      TAVILY_API_KEY: "",
      OLLAMA_BASE_URL: live ? process.env.OLLAMA_BASE_URL || "http://localhost:11434" : "http://127.0.0.1:9",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
