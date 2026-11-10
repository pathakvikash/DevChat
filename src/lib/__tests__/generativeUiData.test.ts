import { describe, it, expect } from "vitest";
import { parseDataArtifact } from "@/lib/generativeUi/data";

describe("parseDataArtifact", () => {
  it("accepts a JSON { columns, rows } object", () => {
    const out = parseDataArtifact(
      '{"columns":["city","pop"],"rows":[["Paris",2148],["Oslo",null]]}',
    );
    expect(out).toEqual({
      columns: ["city", "pop"],
      rows: [
        ["Paris", 2148],
        ["Oslo", null],
      ],
    });
  });

  it("accepts a JSON array of flat objects, unioning keys in first-seen order", () => {
    const out = parseDataArtifact(
      '[{"name":"a","qty":1},{"qty":2,"note":"x"}]',
    );
    expect(out.columns).toEqual(["name", "qty", "note"]);
    expect(out.rows).toEqual([
      ["a", 1, null],
      [null, 2, "x"],
    ]);
  });

  it("accepts CSV with the first row as header and numeric-looking fields as numbers", () => {
    const out = parseDataArtifact("year,revenue\n2024,1500.5\n2025,-2e3\n");
    expect(out).toEqual({
      columns: ["year", "revenue"],
      rows: [
        [2024, 1500.5],
        [2025, -2000],
      ],
    });
  });

  it("handles quoted CSV fields with commas, quotes and newlines", () => {
    const out = parseDataArtifact(
      'name,note\n"Doe, Jane","said ""hi"""\n"multi\nline",\n',
    );
    expect(out).toEqual({
      columns: ["name", "note"],
      rows: [
        ["Doe, Jane", 'said "hi"'],
        ["multi\nline", null],
      ],
    });
  });

  it("rejects content that is neither a data object/array nor CSV", () => {
    expect(() => parseDataArtifact("")).toThrow(/empty/i);
    expect(() => parseDataArtifact("{not json")).toThrow(/not valid JSON/i);
    expect(() => parseDataArtifact('{"foo":1}')).toThrow(/columns/i);
    expect(() => parseDataArtifact("[1,2,3]")).toThrow(/flat object/i);
    expect(() => parseDataArtifact("just some prose")).toThrow(/header row/i);
    // What a run that printed nothing gives back — must not become an artifact.
    expect(() => parseDataArtifact("(no output)")).toThrow(/header row/i);
  });
});
