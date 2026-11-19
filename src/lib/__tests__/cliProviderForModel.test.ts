import { describe, it, expect } from "vitest";
import { cliProviderForModel } from "@/lib/cliProviders";

describe("cliProviderForModel", () => {
  it("needs the provider id and a slash", () => {
    expect(cliProviderForModel("claude-code/sonnet")?.id).toBe("claude-code");
    expect(cliProviderForModel("codex")).toBeUndefined();
    expect(cliProviderForModel("codexy")).toBeUndefined();
    expect(cliProviderForModel("claude-codex")).toBeUndefined();
    expect(cliProviderForModel("gpt-4o")).toBeUndefined();
  });
});
