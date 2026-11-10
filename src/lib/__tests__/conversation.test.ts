import { describe, it, expect } from "vitest";
import {
  joinTextParts,
  extractLatestCode,
  buildMessagesFromConversation,
  lastExchange,
} from "@/lib/utils/conversation";

describe("joinTextParts", () => {
  it("joins text parts from an array", () => {
    const parts = [
      { type: "text", text: "Hello " },
      { type: "text", text: "World" },
    ];
    expect(joinTextParts(parts)).toBe("Hello World");
  });

  it("skips non-text parts", () => {
    const parts = [
      { type: "text", text: "Hello" },
      { type: "tool-invocation", text: "should be ignored" },
      { type: "text", text: " World" },
    ];
    expect(joinTextParts(parts)).toBe("Hello World");
  });

  it("returns empty string for empty array", () => {
    expect(joinTextParts([])).toBe("");
  });

  it("returns empty string for non-array input", () => {
    expect(joinTextParts(null)).toBe("");
    expect(joinTextParts(undefined)).toBe("");
    expect(joinTextParts("not an array")).toBe("");
  });
});

describe("extractLatestCode", () => {
  const textWithPy = "Some text\n```python\nprint('hello')\n```\nmore text";
  const textWithJs = "Text\n```javascript\nconsole.log('hi');\n```\nend";
  const textWithBoth =
    "Py:\n```python\nx = 1\n```\nJS:\n```javascript\nconst y = 2;\n```";

  it("extracts python code block", () => {
    const result = extractLatestCode(textWithPy);
    expect(result).not.toBeNull();
    expect(result!.lang).toBe("python");
    expect(result!.code).toBe("print('hello')");
  });

  it("extracts javascript code block", () => {
    const result = extractLatestCode(textWithJs);
    expect(result).not.toBeNull();
    expect(result!.lang).toBe("javascript");
    expect(result!.code).toBe("console.log('hi');");
  });

  it("returns the last code block when multiple exist", () => {
    const result = extractLatestCode(textWithBoth);
    expect(result).not.toBeNull();
    expect(result!.lang).toBe("javascript");
    expect(result!.code).toBe("const y = 2;");
  });

  it("returns null for text with no code blocks", () => {
    expect(extractLatestCode("Just some text without code")).toBeNull();
  });

  it("returns null for empty text", () => {
    expect(extractLatestCode("")).toBeNull();
  });

  it("returns null for null text", () => {
    expect(extractLatestCode(null as unknown as string)).toBeNull();
  });

  it("handles \\r\\n line endings in code blocks", () => {
    const text = "Some text\r\n```python\r\nprint('hello')\r\n```\r\nmore";
    const result = extractLatestCode(text);
    expect(result).not.toBeNull();
    expect(result!.lang).toBe("python");
    expect(result!.code).toBe("print('hello')");
  });

  it("handles code block without language specifier", () => {
    const text = "```\nplain code\n```";
    const result = extractLatestCode(text);
    expect(result).toBeNull();
  });

  it("recognizes py, python as python", () => {
    const py = extractLatestCode("```py\nx=1\n```");
    expect(py?.lang).toBe("python");
    const python = extractLatestCode("```python\nx=1\n```");
    expect(python?.lang).toBe("python");
  });

  it("recognizes js, javascript, ts, typescript as javascript", () => {
    expect(extractLatestCode("```js\nx\n```")?.lang).toBe("javascript");
    expect(extractLatestCode("```javascript\nx\n```")?.lang).toBe("javascript");
    expect(extractLatestCode("```ts\nx\n```")?.lang).toBe("javascript");
    expect(extractLatestCode("```typescript\nx\n```")?.lang).toBe("javascript");
  });

  it("trims the code content", () => {
    const result = extractLatestCode("```python\n  hello  \n```");
    expect(result?.code).toBe("hello");
  });
});

describe("buildMessagesFromConversation", () => {
  it("maps messages to AppMessage format", () => {
    const conv = {
      messages: [
        { id: "1", role: "user", content: "hello", parts: null, createdAt: new Date("2024-01-01") },
        { id: "2", role: "assistant", content: "hi", parts: null, createdAt: new Date("2024-01-01") },
      ],
    };
    const result = buildMessagesFromConversation(conv);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: "1",
      role: "user",
      parts: [{ type: "text", text: "hello" }],
    });
    expect(result[0].createdAt).toBeDefined();
  });

  it("filters messages before compressedAt", () => {
    const compressedAt = new Date("2024-06-01");
    const conv = {
      compressedSummary: "summary",
      compressedAt,
      compressedBeforeTokens: 1000,
      compressedAfterTokens: 200,
      compressedBeforeMessages: 50,
      messages: [
        { id: "1", role: "user", content: "old", parts: null, createdAt: new Date("2024-01-01") },
        { id: "2", role: "user", content: "new", parts: null, createdAt: new Date("2024-06-15") },
      ],
    };
    const result = buildMessagesFromConversation(conv);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("compression");
    expect(result[0].parts[0].type).toBe("compression-event");
    expect(result[1].id).toBe("2");
  });

  it("does not add compression event when no compressedSummary", () => {
    const conv = {
      messages: [
        { id: "1", role: "user", content: "test", parts: null, createdAt: new Date("2024-01-01") },
      ],
    };
    const result = buildMessagesFromConversation(conv);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
  });

  it("handles null messages gracefully", () => {
    const conv = {};
    const result = buildMessagesFromConversation(conv);
    expect(result).toEqual([]);
  });

  it("parses parts from JSON string", () => {
    const conv = {
      messages: [
        {
          id: "1",
          role: "user",
          content: "",
          parts: JSON.stringify([{ type: "text", text: "hello from parts" }]),
          createdAt: new Date("2024-01-01"),
        },
      ],
    };
    const result = buildMessagesFromConversation(conv);
    expect(result[0].parts).toEqual([{ type: "text", text: "hello from parts" }]);
  });

  it("falls back to content when parts JSON is invalid", () => {
    const conv = {
      messages: [
        {
          id: "1",
          role: "user",
          content: "fallback content",
          parts: "not valid json",
          createdAt: new Date("2024-01-01"),
        },
      ],
    };
    const result = buildMessagesFromConversation(conv);
    expect(result[0].parts).toEqual([{ type: "text", text: "fallback content" }]);
  });

  it("handles compression event with reductionPercent", () => {
    const compressedAt = new Date("2024-06-01");
    const conv = {
      compressedSummary: "summary",
      compressedAt,
      compressedBeforeTokens: 1000,
      compressedAfterTokens: 200,
      compressedBeforeMessages: 50,
      messages: [
        { id: "2", role: "user", content: "new", parts: null, createdAt: new Date("2024-06-15") },
      ],
    };
    const result = buildMessagesFromConversation(conv);
    const event = result[0].parts[0] as any;
    expect(event.reductionPercent).toBe(80);
  });
});

describe("lastExchange", () => {
  const user = { id: "u1", role: "user", parts: [{ type: "text", text: "how do I run the tests?" }] };
  const assistant = { id: "a1", role: "assistant", parts: [{ type: "text", text: "Run npx vitest run." }] };

  it("returns the trailing user/assistant pair as text", () => {
    expect(lastExchange([user, assistant])).toEqual({
      user: "how do I run the tests?",
      assistant: "Run npx vitest run.",
    });
  });

  it("ignores non-text parts and earlier turns", () => {
    const result = lastExchange([
      { id: "u0", role: "user", parts: [{ type: "text", text: "old" }] },
      { id: "a0", role: "assistant", parts: [{ type: "text", text: "older" }] },
      user,
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "thinking" },
          { type: "dynamic-tool", toolName: "Read", output: "secret" },
          { type: "text", text: "Run npx vitest run." },
        ],
      },
    ]);
    expect(result).toEqual({ user: "how do I run the tests?", assistant: "Run npx vitest run." });
  });

  it("returns null when the last message is still the user's", () => {
    expect(lastExchange([assistant, user])).toBeNull();
  });

  it("returns null for a tool-only or empty assistant turn", () => {
    expect(lastExchange([user, { id: "a1", role: "assistant", parts: [{ type: "dynamic-tool", toolName: "Read" }] }])).toBeNull();
    expect(lastExchange([user, { id: "a1", role: "assistant", parts: [{ type: "text", text: "   " }] }])).toBeNull();
  });

  it("returns an empty user string when there is no preceding user turn", () => {
    expect(lastExchange([assistant])).toEqual({ user: "", assistant: "Run npx vitest run." });
  });

  it("returns null for a missing or empty list", () => {
    expect(lastExchange([])).toBeNull();
    expect(lastExchange(undefined)).toBeNull();
    expect(lastExchange(null)).toBeNull();
  });
});
