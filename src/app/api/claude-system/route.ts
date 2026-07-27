import { NextResponse } from "next/server";
import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CLAUDE_DIR = join(homedir(), ".claude");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");

interface FileEntry {
  name: string;
  path: string;
  size: number;
  modified: string;
  content: string;
  type: "md" | "html" | "json" | "jsonl" | "other";
}

interface ClaudeSystemData {
  settings: Record<string, unknown>;
  artifacts: FileEntry[];
  plans: FileEntry[];
  skills: FileEntry[];
  projects: { name: string; files: FileEntry[] }[];
  tasks: { id: string; path: string; steps: { id: string; subject: string; status: string; activeForm: string }[] }[];
}

function readJsonSafe(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function readFilesFromDir(dir: string, allowedExts: string[]): FileEntry[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => {
        const ext = e.name.endsWith(".md") ? "md" : e.name.endsWith(".html") ? "html" : e.name.endsWith(".json") ? "json" : e.name.endsWith(".jsonl") ? "jsonl" : null;
        if (!ext || !allowedExts.includes(ext)) return null;
        const fullPath = join(dir, e.name);
        const stat = statSync(fullPath);
        let content = "";
        try {
          content = readFileSync(fullPath, "utf-8").slice(0, 500);
        } catch {}
        return { name: e.name, path: fullPath, size: stat.size, modified: stat.mtime.toISOString(), content, type: ext };
      })
      .filter((f): f is FileEntry => f !== null);
  } catch {
    return [];
  }
}

function getProjects(): { name: string; files: FileEntry[] }[] {
  if (!existsSync(PROJECTS_DIR)) return [];
  try {
    return readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        const projectDir = join(PROJECTS_DIR, e.name);
        const memoryDir = join(projectDir, "memory");
        const files: FileEntry[] = [];
        for (const dir of [projectDir, memoryDir]) {
          files.push(...readFilesFromDir(dir, ["md", "html"]));
        }
        return { name: e.name, files };
      })
      .filter((p) => p.files.length > 0);
  } catch {
    return [];
  }
}

function getTasks(): { id: string; path: string; steps: { id: string; subject: string; status: string; activeForm: string }[] }[] {
  const dir = join(CLAUDE_DIR, "tasks");
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        const taskDir = join(dir, e.name);
        const steps: { id: string; subject: string; status: string; activeForm: string }[] = [];
        try {
          for (const f of readdirSync(taskDir).filter((f) => f.endsWith(".json") && f !== ".lock")) {
            const data = readJsonSafe(join(taskDir, f));
            if (data) {
              steps.push({
                id: data.id as string,
                subject: (data.subject as string) || "",
                status: (data.status as string) || "",
                activeForm: (data.activeForm as string) || "",
              });
            }
          }
        } catch {}
        return { id: e.name, path: taskDir, steps };
      });
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const settings = readJsonSafe(join(CLAUDE_DIR, "settings.json")) || {};
    const data: ClaudeSystemData = {
      settings,
      artifacts: readFilesFromDir(join(CLAUDE_DIR, "artifacts"), ["md", "html", "json"]),
      plans: readFilesFromDir(join(CLAUDE_DIR, "plans"), ["md", "html", "json"]),
      skills: readFilesFromDir(join(CLAUDE_DIR, "skills"), ["md"]),
      projects: getProjects(),
      tasks: getTasks(),
    };
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to read claude system data:", error);
    return NextResponse.json(
      { error: "Failed to read claude system data" },
      { status: 500 },
    );
  }
}
