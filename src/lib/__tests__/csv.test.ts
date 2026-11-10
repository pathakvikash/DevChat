import { describe, it, expect } from "vitest";
import { csvCell, toCsv, type Column } from "@/lib/workflows/tables";

describe("csvCell", () => {
  it("quotes commas, quotes and newlines (RFC 4180)", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("a\r\nb")).toBe('"a\r\nb"');
  });

  it("puts a ' in front of text a spreadsheet would run as a formula", () => {
    for (const s of ["=SUM(A1)", "+1", "-1+2", "@cmd", "\tcmd", "\rcmd"]) expect(csvCell(s)).toBe(/[\r]/.test(s) ? `"'${s}"` : `'${s}`);
    expect(csvCell("=1,2")).toBe(`"'=1,2"`);
  });

  it("guards a formula that starts after spaces too", () => {
    expect(csvCell(' =HYPERLINK("http://x.test","a")')).toBe(`"' =HYPERLINK(""http://x.test"",""a"")"`);
    expect(csvCell("  +1")).toBe("'  +1");
    expect(csvCell("a =b")).toBe("a =b");
  });

  it("leaves numbers, empties and everything else alone", () => {
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(72)).toBe("72");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell("a=b")).toBe("a=b");
    expect(csvCell(["x", "y"])).toBe('"[""x"",""y""]"');
  });
});

describe("toCsv", () => {
  const columns: Column[] = [
    { key: "title", label: "Title", type: "text" },
    { key: "url", label: "URL", type: "url" },
  ];

  it("writes a header with the status last, then a line per row, ending in a newline", () => {
    const csv = toCsv(columns, [
      { status: "new", data: { title: "A, B", url: "https://a.test" } },
      { status: "read", data: { title: "=evil()" } },
    ]);
    expect(csv).toBe(`\uFEFFTitle,URL,Status\r\n"A, B",https://a.test,new\r\n'=evil(),,read\r\n`);
  });

  it("starts with a UTF-8 byte order mark so Excel reads it as UTF-8", () => {
    expect(toCsv(columns, []).charCodeAt(0)).toBe(0xfeff);
  });

  it("is just the header for a table with no rows", () => {
    expect(toCsv(columns, [])).toBe("\uFEFFTitle,URL,Status\r\n");
  });
});
