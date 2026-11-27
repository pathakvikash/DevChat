import { describe, it, expect } from "vitest";
import { jsonSchemaToZod } from "@/lib/chat/buildTools";

describe("jsonSchemaToZod required handling", () => {
  const schema = {
    type: "object",
    properties: { q: { type: "string" }, limit: { type: "integer" } },
    required: ["q"],
  };

  it("keeps required properties required and makes the rest optional", () => {
    const z = jsonSchemaToZod(schema);
    expect(z.safeParse({ q: "x" }).success).toBe(true);
    expect(z.safeParse({ q: "x", limit: 3 }).success).toBe(true);
    expect(z.safeParse({ limit: 3 }).success).toBe(false);
    expect(z.safeParse({ q: "x", limit: "3" }).success).toBe(false);
  });

  it("treats every property as optional when `required` is absent", () => {
    expect(jsonSchemaToZod({ type: "object", properties: { a: { type: "string" } } }).safeParse({}).success).toBe(true);
  });
});
