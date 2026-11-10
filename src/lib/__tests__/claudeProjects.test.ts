import { describe, expect, it } from "vitest";
import { mergeByCwd } from "@/lib/claude/sessions";

describe("mergeByCwd", () => {
  it("keeps one project per working folder, newest slug, summed sessions, newest first", () => {
    const merged = mergeByCwd([
      { slug: "-Users-v-work-ui", cwd: "/Users/v/work/ui", sessionCount: 3, lastActive: "2026-10-01T00:00:00.000Z" },
      { slug: "-Users-v-api", cwd: "/Users/v/api", sessionCount: 1, lastActive: "2026-10-20T00:00:00.000Z" },
      { slug: "-Users-v-work-ui--claude-worktrees-x", cwd: "/Users/v/work/ui", sessionCount: 2, lastActive: "2026-10-30T00:00:00.000Z" },
    ]);
    expect(merged).toEqual([
      { slug: "-Users-v-work-ui--claude-worktrees-x", cwd: "/Users/v/work/ui", sessionCount: 5, lastActive: "2026-10-30T00:00:00.000Z" },
      { slug: "-Users-v-api", cwd: "/Users/v/api", sessionCount: 1, lastActive: "2026-10-20T00:00:00.000Z" },
    ]);
  });
});
