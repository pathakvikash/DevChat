import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { searchUserChats } from "@/lib/chatSearch";

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const query = req.nextUrl.searchParams.get("q");

    if (!query || query.length < 2) {
      return NextResponse.json({ error: "Query too short" }, { status: 400 });
    }

    const chats = await searchUserChats(userId, query, {
      excludeId: req.nextUrl.searchParams.get("exclude") ?? undefined,
    });

    return NextResponse.json({ chats, count: chats.length });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
