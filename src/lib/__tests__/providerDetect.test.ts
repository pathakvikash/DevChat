import { describe, it, expect } from "vitest";
import { extractCredentials } from "@/lib/providerDetect";

const K = (prefix: string) => `${prefix}${"a1B2c3D4e5F6g7H8".repeat(2)}`; // >= 20 chars

describe("extractCredentials", () => {
  it("reads API keys from the formats other tools use", () => {
    const found = extractCredentials([
      { source: "~/.codex/auth.json", text: `{"OPENAI_API_KEY": "${K("sk-proj-")}", "tokens": {"access_token": "eyJ.oauth.token"}}` },
      { source: "~/.claude/settings.json", text: `{"env": {"ANTHROPIC_API_KEY": "${K("sk-ant-api03-")}"}}` },
      { source: "~/.gemini/.env", text: `GEMINI_API_KEY=${K("AIza")}\n` },
      { source: "~/.zshrc", text: `# stuff\nexport OPENROUTER_API_KEY="${K("sk-or-v1-")}"\nalias ll='ls -la'\n` },
      { source: "~/.config/fish/config.fish", text: `set -gx NVIDIA_NIM_API_KEY ${K("nvapi-")}\n` },
      {
        source: "~/.local/share/opencode/auth.json",
        text: JSON.stringify({
          google: { type: "api", key: K("AIza") },
          anthropic: { type: "oauth", refresh: "r", access: "a", expires: 1 },
        }),
      },
    ]);
    const ids = found.map((f) => `${f.providerId}@${f.source}`).sort();
    expect(ids).toEqual([
      "anthropic@~/.claude/settings.json",
      "google@~/.gemini/.env",
      "google@~/.local/share/opencode/auth.json",
      "nvidia-nim@~/.config/fish/config.fish",
      "openai@~/.codex/auth.json",
      "openrouter@~/.zshrc",
    ]);
    expect(found.find((f) => f.providerId === "openai")?.apiKey).toBe(K("sk-proj-"));
    expect(found.find((f) => f.providerId === "openrouter")?.apiKey).toBe(K("sk-or-v1-"));
  });

  it("never picks up OAuth tokens, placeholders, nulls or unknown providers", () => {
    const found = extractCredentials([
      { source: "~/.codex/auth.json", text: `{"OPENAI_API_KEY": null, "tokens": {"access_token": "${K("eyJ")}"}}` },
      { source: "~/.zshrc", text: `export OPENAI_API_KEY="sk-..."\nexport ANTHROPIC_API_KEY=your-anthropic-api-key-here\nexport STRIPE_API_KEY=${K("sk_live_")}\n` },
      { source: "~/.local/share/opencode/auth.json", text: JSON.stringify({ anthropic: { type: "oauth", access: K("x") } }) },
      { source: "~/.bb/env.json", text: "not json {" },
    ]);
    expect(found).toEqual([]);
  });
});

import { describeTools } from "@/lib/providerDetect";

describe("describeTools", () => {
  const exists = (present: string[]) => (p: string) => present.includes(p);

  it("explains subscription logins instead of reporting an empty scan", () => {
    const report = describeTools(
      exists(["~/.claude", "~/.codex/auth.json", "~/.opencode", "~/.local/share/opencode", "~/.zshrc", "~/.zprofile"]),
      [
        { source: "~/.codex/auth.json", text: '{"OPENAI_API_KEY": null, "tokens": {"access_token": "eyJ"}}' },
        { source: "~/.zshrc", text: "alias ll='ls -la'\n" },
      ],
      [],
    );
    const by = Object.fromEntries(report.map((r) => [r.tool, r]));
    expect(by["Claude Code"].status).toBe("oauth");
    expect(by["Claude Code"].detail).toMatch(/console\.anthropic\.com/);
    expect(by["Codex CLI"].status).toBe("oauth");
    expect(by["OpenCode"].status).toBe("none");
    expect(by["Gemini CLI"].status).toBe("absent");
    expect(by["bb"].status).toBe("absent");
    expect(by["Shell profiles"].status).toBe("none");
    expect(by["Shell profiles"].detail).toContain("~/.zprofile");
  });

  it("reports found keys per tool", () => {
    const report = describeTools(
      exists(["~/.codex/auth.json", "~/.config/opencode", "~/.gemini", "~/.zshrc"]),
      [{ source: "~/.local/share/opencode/auth.json", text: '{"google":{"type":"api","key":"x"}}' }],
      [
        { providerId: "openai", source: "~/.codex/auth.json", apiKey: "k" },
        { providerId: "google", source: "~/.local/share/opencode/auth.json", apiKey: "k" },
        { providerId: "openrouter", source: "~/.zshrc", apiKey: "k" },
      ],
    );
    const by = Object.fromEntries(report.map((r) => [r.tool, r]));
    expect(by["Codex CLI"].status).toBe("keys");
    expect(by["OpenCode"].status).toBe("keys");
    expect(by["Gemini CLI"].status).toBe("none");
    expect(by["Shell profiles"].status).toBe("keys");
    expect(by["Claude Code"].status).toBe("absent");
  });
});

describe("describeTools with installed CLIs", () => {
  it("points subscription users at the CLI-backed provider instead of an API key", () => {
    const report = describeTools(
      (p) => ["~/.claude", "~/.codex/auth.json", "~/.opencode"].includes(p),
      [{ source: "~/.codex/auth.json", text: '{"OPENAI_API_KEY": null, "tokens": {}}' }],
      [],
      "~/.local/share/opencode/auth.json",
      new Set(["claude-code", "opencode"]),
    );
    const by = Object.fromEntries(report.map((r) => [r.tool, r.detail]));
    expect(by["Claude Code"]).toMatch(/model selector/);
    expect(by["OpenCode"]).toMatch(/model selector/);
    expect(by["Codex CLI"]).toMatch(/isn't installed here/);
  });
});
