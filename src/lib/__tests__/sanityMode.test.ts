import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { isSanityMode, SANITY_PROVIDER_ID } from "@/lib/sanityMode";
import { sanityAuthProviders } from "@/lib/sanityAuth";
import { getModel } from "@/lib/models";
import { mockModelCatalog } from "@/lib/mockModels";

const ON = { NODE_ENV: "development", SANITY_TEST_AUTH: "1", DATABASE_URL: "file:/repo/prisma/sanity.db" } as NodeJS.ProcessEnv;

afterEach(() => vi.unstubAllEnvs());

describe("sanity mode gate", () => {
  it("is on only when all three conditions hold", () => {
    expect(isSanityMode(ON)).toBe(true);
    expect(isSanityMode({ ...ON, NODE_ENV: "test" })).toBe(true);
  });

  it("is off in production even with the flag and the sanity DB", () => {
    expect(isSanityMode({ ...ON, NODE_ENV: "production" })).toBe(false);
  });

  it("is off without the flag", () => {
    expect(isSanityMode({ ...ON, SANITY_TEST_AUTH: undefined })).toBe(false);
    expect(isSanityMode({ ...ON, SANITY_TEST_AUTH: "true" })).toBe(false);
  });

  it.each([
    "file:./prisma/dev.db",
    "file:/repo/prisma/not-sanity.db",
    "file:/repo/prisma/sanity.db.bak",
    "postgresql://host/sanity.db",
    "",
  ])("is off when DATABASE_URL is %j", (url) => {
    expect(isSanityMode({ ...ON, DATABASE_URL: url })).toBe(false);
  });

  it("is off when DATABASE_URL is unset", () => {
    expect(isSanityMode({ ...ON, DATABASE_URL: undefined })).toBe(false);
  });
});

describe("test-only login provider", () => {
  it("exists with all three conditions", () => {
    const providers = sanityAuthProviders(ON);
    expect(providers).toHaveLength(1);
    expect((providers[0] as unknown as { options: { id: string } }).options.id).toBe(SANITY_PROVIDER_ID);
  });

  it("is absent in production even with the flag set", () => {
    expect(sanityAuthProviders({ ...ON, NODE_ENV: "production" })).toEqual([]);
  });

  it("is absent when the DB is not the sanity DB", () => {
    expect(sanityAuthProviders({ ...ON, DATABASE_URL: "file:./prisma/dev.db" })).toEqual([]);
  });

  it("is absent without the flag", () => {
    expect(sanityAuthProviders({ ...ON, SANITY_TEST_AUTH: undefined })).toEqual([]);
  });
});

describe("mock model provider", () => {
  function stubOn() {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SANITY_TEST_AUTH", "1");
    vi.stubEnv("DATABASE_URL", "file:/repo/prisma/sanity.db");
  }

  it("registers the scripted models in sanity mode", () => {
    stubOn();
    expect(mockModelCatalog().map((m) => m.id)).toEqual([
      "mock/echo",
      "mock/slow",
      "mock/tool",
      "mock/write",
      "mock/plan",
      "mock/subagent",
      "mock/talker",
      "mock/notools",
      "mock/summary",
    ]);
    expect(getModel("mock/notools").supportsTools).toBe(false);
    expect(getModel("mock/echo").supportsTools).toBe(true);
  });

  it("is not registered in production even with the flag set", () => {
    stubOn();
    vi.stubEnv("NODE_ENV", "production");
    expect(mockModelCatalog()).toEqual([]);
    expect(() => getModel("mock/echo")).toThrow(/not found/);
  });

  it("is not registered when the DB is not the sanity DB", () => {
    stubOn();
    vi.stubEnv("DATABASE_URL", "file:./prisma/dev.db");
    expect(mockModelCatalog()).toEqual([]);
    expect(() => getModel("mock/echo")).toThrow(/not found/);
  });

  it("rejects ids that are not scripted models", () => {
    stubOn();
    expect(() => getModel("mock/nope")).toThrow(/not found/);
    expect(() => getModel("mock/toString")).toThrow(/not found/);
  });

  async function read(id: string, prompt: unknown[]) {
    const { stream } = await getModel(id).model.doStream({ prompt });
    const parts: Array<{ type: string; delta?: string; toolName?: string }> = [];
    for (const reader = stream.getReader(); ; ) {
      const { done, value } = await reader.read();
      if (done) return parts;
      parts.push(value);
    }
  }

  const user = (text: string) => ({ role: "user", content: [{ type: "text", text }] });

  it("mock/echo streams a deterministic reply that echoes the prompt", async () => {
    stubOn();
    const text = (await read("mock/echo", [user("ping 123")])).map((p) => p.delta ?? "").join("");
    expect(text).toBe("Mock reply (deterministic). You said: ping 123");
    expect(text.length).toBeGreaterThan(30);
  });

  it("mock/tool calls the calculator first, then answers once a result exists", async () => {
    stubOn();
    const first = await read("mock/tool", [user("calc")]);
    expect(first.find((p) => p.type === "tool-call")?.toolName).toBe("calculator");
    const toolResult = { role: "tool", content: [{ type: "tool-result", toolCallId: "mock-call-1", toolName: "calculator", output: { type: "text", value: "= 42" } }] };
    const second = await read("mock/tool", [user("calc"), toolResult]);
    expect(second.some((p) => p.type === "tool-call")).toBe(false);
    expect(second.map((p) => p.delta ?? "").join("")).toContain("42");
  });

  it("mock/summary answers a non-streaming call with a summary", async () => {
    stubOn();
    const { content } = await getModel("mock/summary").model.doGenerate({ prompt: [user("summarize")] });
    expect(content[0]).toMatchObject({ type: "text" });
    expect(content[0].text).toContain("Mock summary");
  });
});
