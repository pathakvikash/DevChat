import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/settings", () => ({ getSettingsKeys: vi.fn() }));

import { getSettingsKeys } from "@/lib/settings";
import { resolveProviderCreds } from "@/lib/apiKeys";
import { PROVIDERS } from "@/lib/providers";

const saved = vi.mocked(getSettingsKeys);

beforeEach(() => {
  saved.mockResolvedValue({});
  for (const p of PROVIDERS) vi.stubEnv(p.envKey, "");
  vi.stubEnv("CUSTOM_BASE_URL", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("resolveProviderCreds and the server's env key", () => {
  it("uses the env key with the env base URL when the user saved nothing", async () => {
    vi.stubEnv("CUSTOM_API_KEY", "operator-key");
    vi.stubEnv("CUSTOM_BASE_URL", "https://llm.internal/v1");
    expect((await resolveProviderCreds("u1")).custom).toEqual({ apiKey: "operator-key", baseUrl: "https://llm.internal/v1" });
  });

  it("never pairs the env key with a base URL the user saved", async () => {
    vi.stubEnv("CUSTOM_API_KEY", "operator-key");
    vi.stubEnv("CUSTOM_BASE_URL", "https://llm.internal/v1");
    saved.mockResolvedValue({ customBaseUrl: "https://attacker.example/v1" });
    const creds = await resolveProviderCreds("u1");
    expect(creds.custom).toEqual({ apiKey: "", baseUrl: "https://attacker.example/v1" });
  });

  it("sends the user's own key to the user's base URL", async () => {
    vi.stubEnv("CUSTOM_API_KEY", "operator-key");
    saved.mockResolvedValue({ customBaseUrl: "https://mine.example/v1", customApiKey: "my-key" });
    expect((await resolveProviderCreds("u1")).custom).toEqual({ apiKey: "my-key", baseUrl: "https://mine.example/v1" });
  });

  it("holds for every provider whose base URL a user can set", async () => {
    const settable = PROVIDERS.filter((p) => p.baseUrlSettingKey);
    expect(settable.length).toBeGreaterThan(0);
    for (const p of settable) {
      vi.stubEnv(p.envKey, "operator-key");
      saved.mockResolvedValue({ [p.baseUrlSettingKey!]: "https://attacker.example/v1" });
      const cred = (await resolveProviderCreds("u1"))[p.id];
      expect(cred?.apiKey, p.id).not.toBe("operator-key");
      expect(cred?.baseUrl, p.id).toBe("https://attacker.example/v1");
    }
  });
});
