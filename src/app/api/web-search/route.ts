import { NextRequest, NextResponse } from "next/server";
import { webSearch } from "@/lib/search";

export async function GET(req: NextRequest) {
  try {
    const query = req.nextUrl.searchParams.get("q");
    const provider = (req.nextUrl.searchParams.get("provider") || "duckduckgo") as "tavily" | "duckduckgo";

    if (!query || query.length < 2) {
      return NextResponse.json({ error: "Query too short" }, { status: 400 });
    }

    const { results, usedProvider, warning } = await webSearch(query, provider);

    return NextResponse.json({ results, usedProvider, warning });
  } catch (error) {
    console.error("Web search error:", error);
    return NextResponse.json({ error: "Web search failed" }, { status: 500 });
  }
}
