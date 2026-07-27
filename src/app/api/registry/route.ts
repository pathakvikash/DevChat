import { NextResponse } from "next/server";
import { listSkills, listTools } from "@/lib/registry";

export async function GET() {
  // Strip non-serializable fields (zod schemas, execute fns) for the UI.
  const tools = listTools()
    .filter((t) => !t.internal)
    .map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      enabledByDefault: !!t.enabledByDefault,
      builtIn: !!t.builtIn,
      serverSide: typeof t.execute === "function",
    }));
  const skills = listSkills().map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    toolIds: s.toolIds,
  }));
  return NextResponse.json({ tools, skills });
}
