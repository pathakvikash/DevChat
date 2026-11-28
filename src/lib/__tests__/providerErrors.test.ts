import { describe, expect, it } from "vitest";
import { CREDITS_MESSAGE, friendlyProviderErrorMessage, MODEL_UNAVAILABLE_MESSAGE } from "@/lib/chat/providerErrors";

const served = "openrouter/some-lab/some-model:free";

describe("friendlyProviderErrorMessage: a model the provider no longer serves", () => {
  it.each([
    "This model is unavailable for free",
    '{"error":{"message":"No endpoints found: model not found","code":404}}',
    "The model `x` does not exist or you do not have access to it.",
    "model_not_found",
    "some-model is not a valid model ID",
    '404 {"error":{"message":"model gpt-9 not found"}}',
    '[GoogleGenerativeAI Error]: 404 models/gemini-pro is not found for API version v1beta, or is not supported for generateContent.',
  ])("tells the user to pick another model: %s", (raw) => {
    expect(friendlyProviderErrorMessage(raw, { servedModel: served, isOllama: false })).toBe(MODEL_UNAVAILABLE_MESSAGE);
  });

  it("still reports a bad key as a missing key, and leaves other errors and Ollama alone", () => {
    expect(friendlyProviderErrorMessage("401 Unauthorized", { servedModel: served, isOllama: false })).toMatch(/API key/);
    expect(friendlyProviderErrorMessage("socket hang up", { servedModel: served, isOllama: false })).toBeNull();
    expect(friendlyProviderErrorMessage("model not found", { servedModel: "ollama/x", isOllama: true })).toBeNull();
  });

  it("does not treat an unrelated 400 that mentions the model as the model being unavailable", () => {
    const raw = '400 {"error":{"message":"Request for model claude-x failed: tool get_weather not found"}}';
    expect(friendlyProviderErrorMessage(raw, { servedModel: "anthropic/claude-x", isOllama: false })).toBeNull();
  });

  it("passes a CLI login error through unchanged", () => {
    const raw = "Not logged in. Please run /login. (model not found in session, 401)";
    expect(friendlyProviderErrorMessage(raw, { servedModel: "claude-code/default", isOllama: false })).toBeNull();
  });

  it.each([
    '402 Payment Required',
    '{"error":{"message":"Insufficient credits. Add more using https://openrouter.ai/credits","code":402}}',
    "This request requires more credits, or fewer max_tokens.",
  ])("says the account needs credits: %s", (raw) => {
    expect(friendlyProviderErrorMessage(raw, { servedModel: served, isOllama: false })).toBe(CREDITS_MESSAGE);
    expect(friendlyProviderErrorMessage(raw, { servedModel: "claude-code/default", isOllama: false })).toBeNull();
  });

  it.each([
    "400 {\"error\":{\"message\":\"prompt is 402 tokens too long\"}}",
    "400 prompt is 402 tokens",
    "This request has more credits than expected",
  ])("does not read a plain error as credits: %s", (raw) => {
    expect(friendlyProviderErrorMessage(raw, { servedModel: served, isOllama: false })).not.toBe(CREDITS_MESSAGE);
  });

  it.each(["401 Unauthorized: invalid x-api-key (trace 402)", "403 Forbidden: Payment Required"])("treats a 401/403 as auth, not credits: %s", (raw) => {
    expect(friendlyProviderErrorMessage(raw, { servedModel: served, isOllama: false })).toMatch(/API key/);
  });
});
