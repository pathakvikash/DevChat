import { describe, it, expect } from "vitest";
import {
  parseCommand,
  matchCommands,
  activeCommandQuery,
  missingArg,
  planPrompt,
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
    const r = parseCommand("/plan build me a website");
    expect(r?.command.name).toBe("plan");
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

  it("parses /export as a no-argument action", () => {
    const r = parseCommand("/export");
    expect(r?.command.name).toBe("export");
    expect(r?.command.kind).toBe("action");
    expect(r?.command.requiresArg).toBeFalsy();
  });

  it("parses /recall with its query and requires one", () => {
    const r = parseCommand("/recall cache");
    expect(r?.command.name).toBe("recall");
    expect(r?.arg).toBe("cache");
    expect(r?.command.requiresArg).toBe(true);
  });

  it("treats a /recall query shorter than the search minimum as missing", () => {
    const recall = parseCommand("/recall x")!.command;
    expect(missingArg(recall, "")).toBe(true);
    expect(missingArg(recall, " x ")).toBe(true);
    expect(missingArg(recall, "cache")).toBe(false);
  });

  it("never treats an optional argument as missing", () => {
    expect(missingArg(parseCommand("/compress")!.command, "")).toBe(false);
    expect(missingArg(parseCommand("/plan x")!.command, "")).toBe(true);
  });

  it("parses /compress with a focus and keeps plain /compress valid", () => {
    const r = parseCommand("/compress keep X");
    expect(r?.command.name).toBe("compress");
    expect(r?.arg).toBe("keep X");
    expect(r?.command.requiresArg).toBeFalsy();
    expect(r?.command.usage).toBe("/compress [focus]");
  });

  it("tolerates leading whitespace", () => {
    expect(parseCommand("   /think hard")?.command.name).toBe("think");
  });

  it("transform commands rewrite the message text", () => {
    const r = parseCommand("/think ship the app");
    expect(r?.command.kind).toBe("transform");
    const out = r?.command.transform?.(r.arg);
    expect(out).toContain("ship the app");
  });

  it("/plan is an action that switches to Plan mode", () => {
    const r = parseCommand("/plan add a cache");
    expect(r?.command.kind).toBe("action");
    expect(r?.command.action).toBe("plan");
    expect(r?.arg).toBe("add a cache");
  });

  it("/plan without a task shows the usage hint", () => {
    expect(missingArg(parseCommand("/plan")!.command, "")).toBe(true);
  });

  it("planPrompt is the text /plan sends to a model without tools", () => {
    expect(planPrompt("ship the app")).toContain("Task: ship the app");
  });
});

describe("matchCommands", () => {
  it("returns all commands for an empty query", () => {
    expect(matchCommands("")).toHaveLength(SLASH_COMMANDS.length);
  });

  it("prioritizes prefix matches", () => {
    // A name-prefix hit should outrank commands that just mention it.
    const m = matchCommands("plan");
    expect(m[0].name).toBe("plan");
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
    expect(activeCommandQuery("/plan ship it")).toBeNull();
  });

  it("is null for non-slash input", () => {
    expect(activeCommandQuery("hello")).toBeNull();
  });
});
