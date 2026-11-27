import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// The two schemas differ only in the datasource provider (SQLite locally, Postgres in production).
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/^(\s*provider\s*=\s*)"(sqlite|postgresql)"/m, '$1"DB"');

describe("prisma schemas", () => {
  it("are identical apart from the datasource provider", () => {
    expect(read("prisma/postgres/schema.prisma")).toBe(read("prisma/schema.prisma"));
  });
});
