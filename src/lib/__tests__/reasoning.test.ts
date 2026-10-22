import { describe, it, expect } from "vitest";
import { reasoningPlan, supportsReasoning } from "@/lib/reasoning";

describe("reasoningPlan", () => {
  it("OpenAI: summary on reasoning models, effort only when set and accepted", () => {
    expect(reasoningPlan("openai/gpt-5.6-sol", "high").providerOptions).toEqual({
      openai: { reasoningSummary: "detailed", reasoningEffort: "high" },
    });
    expect(reasoningPlan("openai/gpt-6-luna", "max").providerOptions?.openai).toMatchObject({ reasoningEffort: "max" });
    expect(reasoningPlan("openai/gpt-5.2", "max").providerOptions?.openai).toMatchObject({ reasoningEffort: "high" });
    expect(reasoningPlan("openai/o3", null).providerOptions).toEqual({ openai: { reasoningSummary: "detailed" } });
  });

  it("OpenAI: never sends anything to non-reasoning models", () => {
    for (const id of ["gpt-4o", "gpt-4.1", "gpt-5-chat-latest", "o1-mini", "chatgpt-4o-latest"]) {
      expect(reasoningPlan(`openai/${id}`, "high").providerOptions).toBeUndefined();
    }
  });

  it("OpenAI: -pro models only run at high", () => {
    expect(reasoningPlan("openai/gpt-5-pro", "low").providerOptions?.openai).toMatchObject({ reasoningEffort: "high" });
  });

  it("OpenAI: ignores efforts it does not know, including none", () => {
    expect(reasoningPlan("openai/gpt-5.6-sol", "none").providerOptions).toEqual({ openai: { reasoningSummary: "detailed" } });
  });

  it("Anthropic: adaptive summarized thinking plus effort, never a budget", () => {
    const opts = reasoningPlan("anthropic/claude-opus-5-5", "medium").providerOptions;
    expect(opts).toEqual({ anthropic: { thinking: { type: "adaptive", display: "summarized" }, effort: "medium" } });
    expect(JSON.stringify(opts)).not.toMatch(/budget/i);
    expect(reasoningPlan("anthropic/claude-haiku-5-5").providerOptions).toEqual({
      anthropic: { thinking: { type: "adaptive", display: "summarized" } },
    });
    expect(reasoningPlan("anthropic/claude-fable-5-1", "max").providerOptions?.anthropic).toMatchObject({ effort: "max" });
  });

  it("Anthropic: leaves models without adaptive thinking alone", () => {
    for (const id of ["claude-sonnet-4-5", "claude-opus-4-1-20250805", "claude-sonnet-4-20250514", "claude-3-5-haiku-latest", "claude-haiku-4-5"]) {
      expect(reasoningPlan(`anthropic/${id}`, "high").providerOptions).toBeUndefined();
    }
    expect(reasoningPlan("anthropic/claude-opus-4-6", "high").providerOptions).toBeDefined();
  });

  it("Google: drops sampling params on Gemini 3.6+ and passes effort through the compat key", () => {
    for (const id of ["gemini-3.6-pro", "gemini-3.8-flash", "gemini-4-pro"]) {
      expect(reasoningPlan(`google/${id}`).allowSampling).toBe(false);
    }
    for (const id of ["gemini-3.5-pro", "gemini-2.5-flash"]) {
      expect(reasoningPlan(`google/${id}`).allowSampling).toBe(true);
    }
    expect(reasoningPlan("google/gemini-3.8-flash", "low").providerOptions).toEqual({ openai: { reasoningEffort: "low" } });
    expect(reasoningPlan("google/gemini-3.8-flash", "max").providerOptions).toEqual({ openai: { reasoningEffort: "high" } });
    expect(reasoningPlan("google/gemini-3.8-flash").providerOptions).toBeUndefined();
    expect(reasoningPlan("google/gemma-3-27b", "high").providerOptions).toBeUndefined();
    expect(reasoningPlan("google/gemini-2.0-flash", "high").providerOptions).toBeUndefined();
    expect(reasoningPlan("google/gemini-30-pro").allowSampling).toBe(false);
    expect(supportsReasoning("google/gemini-2.5-pro")).toBe(true);
    expect(supportsReasoning("google/gemini-2.0-flash")).toBe(false);
    expect(supportsReasoning("openai/gpt-4o")).toBe(false);
    expect(supportsReasoning("anthropic/claude-opus-5-5")).toBe(true);
  });

  it("other providers and local models are untouched", () => {
    for (const id of ["openrouter/x/y", "nvidia-nim/a/b", "custom/m", "ollama/llama3", "codex/gpt-5"]) {
      expect(reasoningPlan(id, "high")).toEqual({ allowSampling: true });
    }
  });
});
