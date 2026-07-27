import { describe, it, expect } from "vitest";
import {
  parseCommand,
  matchCommands,
  activeCommandQuery,
  SLASH_COMMANDS,
} from "@/lib/commands";

describe("parseCommand", () => {
  it("returns null for non-slash input", () => {
    expect(parseCommand("hello world")).toBeNull();
    expect(parseCommand("  not a command")).toBeNull();
  });

  it("returns null for unknown commands (falls through to chat)", () => {
    expect(parseCommand("/notarealcommand foo")).toBeNull();
  });

  it("parses a command and its argument", () => {
    const r = parseCommand("/goal build me a website");
    expect(r?.command.name).toBe("goal");
    expect(r?.arg).toBe("build me a website");
  });

  it("parses a no-arg command", () => {
    const r = parseCommand("/compress");
    expect(r?.command.name).toBe("compress");
    expect(r?.arg).toBe("");
  });

  it("resolves aliases to the canonical command", () => {
    expect(parseCommand("/web cats")?.command.name).toBe("search");
    expect(parseCommand("/notes")?.command.name).toBe("scratchpad");
  });

  it("tolerates leading whitespace", () => {
    expect(parseCommand("   /think hard")?.command.name).toBe("think");
  });

  it("transform commands rewrite the message text", () => {
    const r = parseCommand("/plan ship the app");
    expect(r?.command.kind).toBe("transform");
    const out = r?.command.transform?.(r.arg);
    expect(out).toContain("ship the app");
    expect(out).toContain("plan");
  });
});

describe("matchCommands", () => {
  it("returns all commands for an empty query", () => {
    expect(matchCommands("")).toHaveLength(SLASH_COMMANDS.length);
  });

  it("prioritizes prefix matches", () => {
    const m = matchCommands("go");
    expect(m[0].name).toBe("goal");
  });

  it("matches by alias prefix", () => {
    expect(matchCommands("ref").some((c) => c.name === "loop")).toBe(true);
  });
});

describe("activeCommandQuery", () => {
  it("is the token after the slash while typing the name", () => {
    expect(activeCommandQuery("/go")).toBe("go");
    expect(activeCommandQuery("/")).toBe("");
  });

  it("is null once an argument is being typed", () => {
    expect(activeCommandQuery("/goal ship it")).toBeNull();
  });

  it("is null for non-slash input", () => {
    expect(activeCommandQuery("hello")).toBeNull();
  });
});
