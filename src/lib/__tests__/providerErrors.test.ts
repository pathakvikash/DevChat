import { describe, expect, it } from "vitest";
import { friendlyProviderErrorMessage, MODEL_UNAVAILABLE_MESSAGE } from "@/lib/chat/providerErrors";

const served = "openrouter/some-lab/some-model:free";

describe("friendlyProviderErrorMessage: a model the provider no longer serves", () => {
  it.each([
    "This model is unavailable for free",
    '{"error":{"message":"No endpoints found: model not found","code":404}}',
    "The model `x` does not exist or you do not have access to it.",
    "model_not_found",
    "some-model is not a valid model ID",
  ])("tells the user to pick another model: %s", (raw) => {
    expect(friendlyProviderErrorMessage(raw, { servedModel: served, isOllama: false })).toBe(MODEL_UNAVAILABLE_MESSAGE);
  });

  it("still reports a bad key as a missing key, and leaves other errors and Ollama alone", () => {
    expect(friendlyProviderErrorMessage("401 Unauthorized", { servedModel: served, isOllama: false })).toMatch(/API key/);
    expect(friendlyProviderErrorMessage("socket hang up", { servedModel: served, isOllama: false })).toBeNull();
    expect(friendlyProviderErrorMessage("model not found", { servedModel: "ollama/x", isOllama: true })).toBeNull();
  });
});
