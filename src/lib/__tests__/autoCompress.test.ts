import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/compression", () => ({
  shouldAutoCompress: vi.fn(),
  compressConversation: vi.fn(),
  saveCompressedSummary: vi.fn(),
  DEFAULT_COMPACTION_MODEL: "compact-model",
}));

import {
  shouldAutoCompress,
  compressConversation,
  saveCompressedSummary,
} from "@/lib/compression";
import { AUTO_COMPRESS_TIMEOUT_MS, autoCompress, canAutoCompress } from "@/lib/chat/autoCompress";

const cutAt = new Date("2024-06-01T12:00:00Z");
const compressed = {
  summary: "s",
  beforeTokens: 10,
  afterTokens: 2,
  beforeMessages: 3,
  reductionTokens: 8,
  reductionPercent: 80,
  cutAt,
} as any;

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(shouldAutoCompress).mockResolvedValue(true);
  vi.mocked(saveCompressedSummary).mockResolvedValue(undefined);
});

describe("autoCompress", () => {
  it("compresses with a deadline and saves the summary at the cut point", async () => {
    vi.mocked(compressConversation).mockResolvedValue(compressed);

    await autoCompress("c1", 85);

    expect(shouldAutoCompress).toHaveBeenCalledExactlyOnceWith("c1", 85);
    expect(compressConversation).toHaveBeenCalledExactlyOnceWith("c1", "compact-model", {
      timeoutMs: AUTO_COMPRESS_TIMEOUT_MS,
    });
    expect(saveCompressedSummary).toHaveBeenCalledExactlyOnceWith(
      "c1",
      "s",
      { beforeTokens: 10, afterTokens: 2, beforeMessages: 3 },
      cutAt,
    );
  });

  it("resolves only after the summary is saved", async () => {
    let finish!: (r: any) => void;
    vi.mocked(compressConversation).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    let resolved = false;

    const done = autoCompress("c1", 85).then(() => (resolved = true));
    await vi.waitFor(() => expect(compressConversation).toHaveBeenCalled());
    expect(resolved).toBe(false);
    finish(compressed);
    await done;

    expect(saveCompressedSummary).toHaveBeenCalledTimes(1);
  });

  it("announces before compression starts", async () => {
    const calls: string[] = [];
    vi.mocked(compressConversation).mockImplementation(async () => {
      calls.push("compress");
      return compressed;
    });

    await autoCompress("c1", 85, () => calls.push("announce"));

    expect(calls).toEqual(["announce", "compress"]);
  });

  it("does nothing, and announces nothing, when the chat is under the threshold", async () => {
    vi.mocked(shouldAutoCompress).mockResolvedValue(false);
    const onCompressing = vi.fn();

    await autoCompress("c1", 85, onCompressing);

    expect(onCompressing).not.toHaveBeenCalled();
    expect(compressConversation).not.toHaveBeenCalled();
  });

  it("ends normally when compression fails or times out (it returns null)", async () => {
    vi.mocked(compressConversation).mockResolvedValue(null);

    await expect(autoCompress("c1", 85)).resolves.toBeUndefined();

    expect(saveCompressedSummary).not.toHaveBeenCalled();
  });

  it("ends normally when something in compression throws", async () => {
    vi.mocked(compressConversation).mockRejectedValue(new Error("ollama down"));

    await expect(autoCompress("c1", 85)).resolves.toBeUndefined();

    expect(saveCompressedSummary).not.toHaveBeenCalled();
  });
});

describe("canAutoCompress", () => {
  const text = { steps: [{ text: "hi" }], finishReason: "stop" };

  it("allows a turn that finished cleanly", () => {
    expect(canAutoCompress(text, false)).toBe(true);
  });

  it("refuses a stopped turn", () => {
    expect(canAutoCompress(text, true)).toBe(false);
  });

  it.each([
    ["errored", { steps: [{ text: "partial" }], finishReason: "error" }],
    ["ended with no finished step", { steps: [] }],
  ])("refuses a turn that %s", (_name, event) => {
    expect(canAutoCompress(event, false)).toBe(false);
  });

  it("refuses while a client-side tool call has no result", () => {
    const event = {
      steps: [{ toolCalls: [{ toolCallId: "t1" }], toolResults: [] }],
      finishReason: "tool-calls",
    };

    expect(canAutoCompress(event, false)).toBe(false);
  });

  it("allows a turn stopWhen cut after its tool results came back", () => {
    const event = {
      steps: [{ toolCalls: [{ toolCallId: "t1" }], toolResults: [{ toolCallId: "t1" }] }],
      finishReason: "tool-calls",
    };

    expect(canAutoCompress(event, false)).toBe(true);
  });

  it("treats a failed server tool call as done", () => {
    const event = {
      steps: [
        {
          toolCalls: [{ toolCallId: "t1" }],
          toolResults: [],
          content: [{ type: "tool-error", toolCallId: "t1" }],
        },
      ],
      finishReason: "stop",
    };

    expect(canAutoCompress(event, false)).toBe(true);
  });
});
