// Test-only login and mock models exist only while all three conditions hold.
// Every guard goes through this one function so there is a single place to audit.
// The literal `process.env.NODE_ENV` is inlined by `next build`, so a production build
// drops the whole gate as dead code; `env` is only read at runtime and can't do that.
const SANITY_DB_URL = /^file:(.*[\\/])?sanity\.db(\?.*)?$/;

export function isSanityMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    env.NODE_ENV !== "production" &&
    env.SANITY_TEST_AUTH === "1" &&
    SANITY_DB_URL.test(env.DATABASE_URL ?? "")
  );
}

export const SANITY_PROVIDER_ID = "sanity-test";
export const SANITY_USER = { email: "sanity@devchat.test", name: "Sanity Test User" };
