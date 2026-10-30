import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { editInsideCwd } from "@/lib/editScope";

let root: string;
let cwd: string;
let outside: string;

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "edit-scope-")));
  cwd = join(root, "project");
  outside = join(root, "outside");
  for (const d of [cwd, join(cwd, "src"), join(cwd, ".git", "hooks"), join(cwd, ".claude"), join(cwd, ".husky"), join(cwd, ".githooks"), join(cwd, "~"), outside]) mkdirSync(d, { recursive: true });
  writeFileSync(join(cwd, "src", "a.ts"), "a");
  writeFileSync(join(outside, "secret"), "s");
  symlinkSync(outside, join(cwd, "link-dir"));
  symlinkSync(join(outside, "secret"), join(cwd, "link-file"));
  symlinkSync(join(outside, "not-yet"), join(cwd, "dangling"));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const edit = (file_path: string) => editInsideCwd(cwd, "Edit", { file_path });

describe("editInsideCwd", () => {
  it("accepts an absolute path to a file in the folder, or a new file in an existing subfolder", () => {
    expect(edit(join(cwd, "src", "a.ts"))).toBe(true);
    expect(edit(join(cwd, "src", "new.ts"))).toBe(true);
    expect(edit(join(cwd, "top.txt"))).toBe(true);
    expect(edit(join(cwd, "src", "..", "src", "a.ts"))).toBe(true);
    for (const tool of ["Edit", "Write", "MultiEdit"]) expect(editInsideCwd(cwd, tool, { file_path: join(cwd, "a") })).toBe(true);
    expect(editInsideCwd(cwd, "NotebookEdit", { notebook_path: join(cwd, "n.ipynb") })).toBe(true);
  });

  it("refuses a relative path, including ~, even when the folder has a matching subfolder", () => {
    expect(edit("src/a.ts")).toBe(false);
    expect(edit("./src/a.ts")).toBe(false);
    expect(edit("~/.zshrc")).toBe(false);
    expect(edit("~/x")).toBe(false);
  });

  it("does not read a relative path against the folder, or against wherever the server runs", () => {
    const spy = vi.spyOn(process, "cwd").mockReturnValue(cwd);
    try {
      expect(edit("src/a.ts")).toBe(false);
      expect(edit("~/x")).toBe(false);
      expect(edit("top.txt")).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("reads the path key that belongs to the tool, and no other", () => {
    const inside = join(cwd, "a");
    const outsidePath = join(outside, "x");
    expect(editInsideCwd(cwd, "NotebookEdit", { file_path: inside })).toBe(false);
    expect(editInsideCwd(cwd, "NotebookEdit", { file_path: inside, notebook_path: outsidePath })).toBe(false);
    expect(editInsideCwd(cwd, "Edit", { notebook_path: inside })).toBe(false);
    expect(editInsideCwd(cwd, "Edit", { file_path: outsidePath, notebook_path: inside })).toBe(false);
    expect(editInsideCwd(cwd, "Write", { notebook_path: inside })).toBe(false);
    expect(editInsideCwd(cwd, "Bash", { file_path: inside })).toBe(false);
    expect(editInsideCwd(cwd, "constructor", { file_path: inside })).toBe(false);
  });

  it("refuses paths outside the folder, however they are spelled", () => {
    expect(edit(join(root, ".zshrc"))).toBe(false);
    expect(edit(join(cwd, "..", "outside", "secret"))).toBe(false);
    expect(edit("../project-evil/x")).toBe(false);
    expect(edit("/etc/passwd")).toBe(false);
    expect(edit(cwd)).toBe(false);
  });

  it("refuses a new file whose folder does not exist yet", () => {
    expect(edit(join(cwd, "nope", "deeper", "x.ts"))).toBe(false);
  });

  it("refuses folders that run code on commit, too", () => {
    expect(edit(join(cwd, ".husky", "pre-commit"))).toBe(false);
    expect(edit(join(cwd, ".githooks", "pre-push"))).toBe(false);
    expect(edit(join(cwd, "src", ".husky", "x"))).toBe(false);
    expect(edit(join(cwd, ".huskyrc"))).toBe(true);
  });

  it("refuses .git and .claude at any depth, in any letter case", () => {
    expect(edit(join(cwd, ".git", "hooks", "pre-commit"))).toBe(false);
    expect(edit(join(cwd, ".git", "config"))).toBe(false);
    expect(edit(join(cwd, ".claude", "settings.json"))).toBe(false);
    expect(edit(join(cwd, "src", ".claude", "x"))).toBe(false);
    expect(edit(join(cwd, ".GIT", "hooks", "x"))).toBe(false);
    expect(edit(join(cwd, ".gitignore"))).toBe(true);
  });

  it("follows symlinks: a link out of the folder is out of the folder", () => {
    expect(edit(join(cwd, "link-dir", "x"))).toBe(false);
    expect(edit(join(cwd, "link-dir", "secret"))).toBe(false);
    expect(edit(join(cwd, "link-file"))).toBe(false);
    expect(edit(join(cwd, "dangling"))).toBe(false);
  });

  it("refuses when there is no usable path or the folder is not there", () => {
    expect(editInsideCwd(cwd, "Edit", {})).toBe(false);
    expect(editInsideCwd(cwd, "Edit", { file_path: 7 })).toBe(false);
    expect(editInsideCwd(cwd, "Edit", null)).toBe(false);
    expect(editInsideCwd(join(root, "missing"), "Edit", { file_path: join(cwd, "a") })).toBe(false);
  });
});
