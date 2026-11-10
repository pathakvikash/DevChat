import { describe, it, expect } from "vitest";
import { composeFileBlocks, cutFiles, cutNotesIn, fenceFor, findMentionQuery, formatSize, matchMentionFiles } from "@/lib/utils/fileMentions";

describe("findMentionQuery", () => {
  it("opens at the start of the text or after whitespace", () => {
    expect(findMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
    expect(findMentionQuery("read @chat/ro", 13)).toEqual({ start: 5, query: "chat/ro" });
    expect(findMentionQuery("a\n@b", 4)).toEqual({ start: 2, query: "b" });
  });

  it("ignores an @ inside a word, such as an email address", () => {
    expect(findMentionQuery("mail a@b.com", 12)).toBeNull();
    expect(findMentionQuery("mail a@b.com @x", 15)).toEqual({ start: 13, query: "x" });
  });

  it("closes once a space follows the @", () => {
    expect(findMentionQuery("@a b", 4)).toBeNull();
  });

  it("reads only up to the caret", () => {
    expect(findMentionQuery("@foo bar", 4)).toEqual({ start: 0, query: "foo" });
  });
});

describe("matchMentionFiles", () => {
  it("matches case-insensitively and caps the rows", () => {
    const rows = [{ path: "src/App.tsx", size: 1 }, { path: "README.md", size: 2 }, { path: "src/app/x.ts", size: 3 }];
    expect(matchMentionFiles(rows, "APP").map((f) => f.path)).toEqual(["src/App.tsx", "src/app/x.ts"]);
    expect(matchMentionFiles([{ path: "a1" }, { path: "a2" }, { path: "a3" }], "a", 2)).toHaveLength(2);
  });
});

describe("formatSize", () => {
  it("picks B, KB or MB", () => {
    expect(formatSize(812)).toBe("812 B");
    expect(formatSize(4300)).toBe("4.2 KB");
    expect(formatSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("fenceFor", () => {
  it("is three backticks when the content has none", () => {
    expect(fenceFor("plain text")).toBe("```");
  });

  it("is longer than the longest backtick run inside the content", () => {
    expect(fenceFor("a ``` b")).toBe("````");
    expect(fenceFor("````` and ``")).toBe("``````");
  });
});

describe("composeFileBlocks", () => {
  const numbered = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n");

  it("returns nothing when no files are picked", async () => {
    expect(await composeFileBlocks([], 1000)).toBe("");
  });

  it("writes a path header and a fence, with no note when the file fits", async () => {
    const out = await composeFileBlocks([{ path: "src/a.ts", content: "const x = 1;" }], 1000);
    expect(out).toBe("File: src/a.ts\n```ts\nconst x = 1;\n```");
  });

  it("cuts at a line boundary and reports the lines kept", async () => {
    const out = await composeFileBlocks([{ path: "notes.md", content: numbered(200) }], 100);
    const match = /\(cut: first (\d+) of 200 lines\)$/.exec(out);
    expect(match).not.toBeNull();
    const kept = Number(match![1]);
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(200);
    const body = out.split("\n").slice(2, 2 + kept);
    expect(body).toEqual(Array.from({ length: kept }, (_, i) => `line ${i + 1}`));
  });

  it("splits the budget evenly, so a big file is cut and a small one is not", async () => {
    const out = await composeFileBlocks(
      [
        { path: "small.txt", content: "tiny" },
        { path: "big.txt", content: numbered(500) },
      ],
      300,
    );
    const [small, big] = out.split("\n\nFile: ");
    expect(small).toContain("tiny");
    expect(small).not.toContain("(cut");
    expect(big).toMatch(/\(cut: first \d+ of 500 lines\)$/);
  });

  it("reports the kept and total lines of a cut file for the chip note", async () => {
    const [cut] = await cutFiles([{ path: "notes.md", content: numbered(200) }], 100);
    expect(cut.cut).toBe(true);
    expect(cut.total).toBe(200);
    expect(cut.kept).toBeGreaterThan(0);
    expect(cut.text?.split("\n")).toHaveLength(cut.kept);
    const [small] = await cutFiles([{ path: "a.ts", content: "x" }], 100);
    expect(small.cut).toBe(false);
  });

  it("never says 'first 0 of 1 lines' for a one-line file", async () => {
    const long = "word ".repeat(400).trim();
    const out = await composeFileBlocks([{ path: "min.js", content: long }], 50);
    expect(out).not.toContain("first 0 of 1 lines");
    expect(out).toContain("(cut: part of the only line)");
    expect(out.split("\n")[2].length).toBeGreaterThan(0);
  });

  it("finds the cut notes in a sent message, for the sent bubble", async () => {
    const out = await composeFileBlocks(
      [
        { path: "small.txt", content: "tiny" },
        { path: "big.txt", content: numbered(500) },
      ],
      300,
    );
    const notes = cutNotesIn(out);
    expect(notes).toHaveLength(1);
    expect(notes[0].path).toBe("big.txt");
    expect(notes[0].detail).toMatch(/^first \d+ of 500 lines$/);
    expect(cutNotesIn("no files here")).toEqual([]);
  });

  it("writes 'could not read' for a file that cannot be read", async () => {
    expect(await composeFileBlocks([{ path: "gone.ts", content: null }], 1000)).toBe("could not read gone.ts");
  });

  it("uses a fence longer than any backtick run in the file", async () => {
    const out = await composeFileBlocks([{ path: "readme.md", content: "```js\nx\n```" }], 1000);
    expect(out).toBe("File: readme.md\n````md\n```js\nx\n```\n````");
  });
});
