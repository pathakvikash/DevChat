import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import base from "../playwright.config";

// Runs only scripts/marketing-shots.spec.ts (`npm run marketing:shots`). Same sanity server, DB and mock models as
// the e2e suite, but the e2e testDir (and so scripts/sanity.mjs) never sees it.
export default defineConfig({
  ...base,
  testDir: __dirname,
  testMatch: /marketing-shots\.spec\.ts/,
  retries: 0,
  reporter: [["list"]],
  grepInvert: undefined,
  // Next must start from the repo root, not from this folder.
  webServer: { ...(base.webServer as object), cwd: path.join(__dirname, "..") } as typeof base.webServer,
  use: { baseURL: base.use?.baseURL, locale: "en-US", timezoneId: "UTC" },
  projects: [
    { name: "shots", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme: "light" } },
  ],
});
