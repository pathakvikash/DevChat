import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";

// HOME is a temp dir before the app loads, so the project list is empty and only the sanity hook can add a folder.
const home = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("fs");
  const { tmpdir } = await import("os");
  const { join } = await import("path");
  const dir = mkdtempSync(join(tmpdir(), "cwds-home-"));
  process.env.HOME = dir;
  return dir;
});

import { runnableCwds } from "@/lib/claude/sessions";

const FOLDER = "/fixtures/sanity-folder";
const SANITY_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "development",
  SANITY_TEST_AUTH: "1",
  DATABASE_URL: "file:/repo/prisma/sanity.db",
  SANITY_WORKING_FOLDER: FOLDER,
};
const saved = { ...process.env };

beforeAll(() => {
  mkdirSync(join(home, ".claude", "projects"), { recursive: true });
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

afterEach(() => {
  process.env = { ...saved };
});

describe("runnableCwds", () => {
  it("adds SANITY_WORKING_FOLDER while the sanity mode is on", async () => {
    process.env = { ...saved, ...SANITY_ENV };
    expect((await runnableCwds()).has(FOLDER)).toBe(true);
  });

  it("ignores SANITY_WORKING_FOLDER when the sanity test auth is off", async () => {
    process.env = { ...saved, ...SANITY_ENV, SANITY_TEST_AUTH: undefined };
    expect((await runnableCwds()).has(FOLDER)).toBe(false);
  });

  it("ignores SANITY_WORKING_FOLDER in production", async () => {
    process.env = { ...saved, ...SANITY_ENV, NODE_ENV: "production" };
    expect((await runnableCwds()).has(FOLDER)).toBe(false);
  });

  it("ignores SANITY_WORKING_FOLDER when the database is not the sanity file", async () => {
    process.env = { ...saved, ...SANITY_ENV, DATABASE_URL: "file:/repo/prisma/dev.db" };
    expect((await runnableCwds()).has(FOLDER)).toBe(false);
  });
});
