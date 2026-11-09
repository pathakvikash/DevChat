import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { mergeAuthConfig, redactAuthConfig } from "@/lib/api/mcpServers";

describe("clearing a secret on purpose", () => {
  const stored = JSON.stringify({ apiKey: "k", clientSecret: "s", clientId: "c", scopes: "read" });
  it("an explicit null deletes the key, and an empty scopes string clears scopes", () => {
    expect(JSON.parse(mergeAuthConfig(stored, { apiKey: null }))).toEqual({ clientSecret: "s", clientId: "c", scopes: "read" });
    expect(JSON.parse(mergeAuthConfig(stored, { scopes: "" })).scopes).toBe("");
  });
  it("switching the auth type drops the secrets the new type does not use", () => {
    expect(JSON.parse(mergeAuthConfig(stored, {}, "apikey"))).toEqual({ apiKey: "k", clientId: "c", scopes: "read" });
    expect(JSON.parse(mergeAuthConfig(stored, {}, "oauth2"))).toEqual({ clientSecret: "s", clientId: "c", scopes: "read" });
    expect(JSON.parse(mergeAuthConfig(stored, {}, "none"))).toEqual({ clientId: "c", scopes: "read" });
  });
});

describe("MCP server auth never reaches the browser", () => {
  it("drops the API key and client secret and says which are set", () => {
    const r = redactAuthConfig(JSON.stringify({ apiKey: "sk-live-123", clientId: "cid", clientSecret: "shh", scopes: "read" }));
    expect(JSON.stringify(r)).not.toMatch(/sk-live-123|shh/);
    expect(JSON.parse(r.authConfig!)).toEqual({ clientId: "cid", scopes: "read" });
    expect(r).toMatchObject({ hasApiKey: true, hasClientSecret: true });
  });

  it("copes with no auth and with bad JSON", () => {
    expect(redactAuthConfig(null)).toEqual({ authConfig: undefined, hasApiKey: false, hasClientSecret: false });
    expect(redactAuthConfig("{nope")).toMatchObject({ hasApiKey: false });
  });

  it("keeps the stored secret when an edit leaves the field empty, and replaces it when one is typed", () => {
    const stored = JSON.stringify({ clientId: "old", clientSecret: "keep-me" });
    expect(JSON.parse(mergeAuthConfig(stored, { clientId: "new", clientSecret: "" }))).toEqual({ clientId: "new", clientSecret: "keep-me" });
    expect(JSON.parse(mergeAuthConfig(stored, { clientId: "new" }))).toEqual({ clientId: "new", clientSecret: "keep-me" });
    expect(JSON.parse(mergeAuthConfig(stored, { clientSecret: "fresh" })).clientSecret).toBe("fresh");
  });
});
