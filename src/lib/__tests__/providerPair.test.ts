import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execFileSync } from "child_process";

vi.mock("@/lib/db", () => ({
  prisma: {
    appSetting: { deleteMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), delete: vi.fn() },
  },
}));
vi.mock("@/lib/settings", () => ({ setSettingsKey: vi.fn() }));

import { prisma } from "@/lib/db";
import { setSettingsKey } from "@/lib/settings";
import { createPairingCode, redeemPairingCode, buildConnectScript } from "@/lib/providerPair";

const KEY = "sk-proj-" + "a1B2c3D4e5F6g7H8".repeat(2);

beforeEach(() => vi.clearAllMocks());

describe("pairing codes", () => {
  it("mints a fresh single code per user", async () => {
    const code = await createPairingCode("u1");
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/);
    expect(prisma.appSetting.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", key: { startsWith: "pairingCode:" } },
    });
    expect(prisma.appSetting.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "u1", key: `pairingCode:${code}` }),
    });
  });

  it("rejects unknown codes and saves nothing", async () => {
    (prisma.appSetting.findFirst as any).mockResolvedValue(null);
    expect(await redeemPairingCode("NOPE", [{ providerId: "openai", apiKey: KEY }])).toBeNull();
    expect(setSettingsKey).not.toHaveBeenCalled();
  });

  it("consumes expired codes without importing", async () => {
    (prisma.appSetting.findFirst as any).mockResolvedValue({ id: "r1", userId: "u1", value: String(Date.now() - 1) });
    expect(await redeemPairingCode("OLD", [{ providerId: "openai", apiKey: KEY }])).toBeNull();
    expect(prisma.appSetting.delete).toHaveBeenCalledWith({ where: { id: "r1" } });
    expect(setSettingsKey).not.toHaveBeenCalled();
  });

  it("imports only well-formed keys for known providers, then burns the code", async () => {
    (prisma.appSetting.findFirst as any).mockResolvedValue({ id: "r1", userId: "u1", value: String(Date.now() + 60_000) });
    const imported = await redeemPairingCode("GOOD", [
      { providerId: "openai", apiKey: KEY },
      { providerId: "custom", apiKey: KEY }, // allowed: a key, not a base URL
      { providerId: "openai", apiKey: "short" },
      { providerId: "nope", apiKey: KEY },
      { providerId: "anthropic", apiKey: 42 },
    ]);
    expect(imported).toEqual(["OpenAI", "Custom OpenAI-compatible"]);
    expect(setSettingsKey).toHaveBeenCalledTimes(2);
    expect(setSettingsKey).toHaveBeenCalledWith("u1", "openaiApiKey", KEY);
    expect(prisma.appSetting.delete).toHaveBeenCalledWith({ where: { id: "r1" } });
  });
});

describe("connect script", () => {
  function runScript(home: string, args: string[]) {
    const dir = mkdtempSync(join(tmpdir(), "devchat-script-"));
    const file = join(dir, "connect.js");
    writeFileSync(file, buildConnectScript("https://devchat.example"));
    return execFileSync(process.execPath, [file, ...args], {
      env: { ...process.env, HOME: home, XDG_DATA_HOME: join(home, ".local", "share") },
      encoding: "utf8",
    });
  }

  it("finds the same keys as the server scanner and never prints them raw", () => {
    const home = mkdtempSync(join(tmpdir(), "devchat-home-"));
    mkdirSync(join(home, ".codex"));
    writeFileSync(join(home, ".codex", "auth.json"), JSON.stringify({ OPENAI_API_KEY: KEY, tokens: { access_token: "eyJ.oauth" } }));
    writeFileSync(join(home, ".zshrc"), `export OPENROUTER_API_KEY="sk-or-v1-${"x1y2z3".repeat(6)}"\n`);
    mkdirSync(join(home, ".local", "share", "opencode"), { recursive: true });
    writeFileSync(
      join(home, ".local", "share", "opencode", "auth.json"),
      JSON.stringify({ google: { type: "api", key: "AIza" + "q".repeat(35) }, anthropic: { type: "oauth", access: "a".repeat(40) } }),
    );

    const out = runScript(home, ["--list"]);
    expect(out).toContain("Found 3 API key(s)");
    expect(out).toContain("OpenAI");
    expect(out).toContain("OpenRouter");
    expect(out).toContain("Google Gemini");
    expect(out).not.toContain("Anthropic");
    expect(out).not.toContain(KEY);
    expect(out).toContain("~/.codex/auth.json");
  });

  it("reports cleanly when nothing is stored", () => {
    const home = mkdtempSync(join(tmpdir(), "devchat-empty-"));
    expect(runScript(home, ["--list"])).toContain("No API keys found");
  });
});
