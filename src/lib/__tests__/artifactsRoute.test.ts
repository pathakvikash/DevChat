import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/artifacts/route";

vi.mock("@/lib/db", () => ({ prisma: { artifact: { findMany: vi.fn() } } }));
vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn().mockResolvedValue("user-1") }));

import { prisma } from "@/lib/db";
const findMany = vi.mocked(prisma.artifact.findMany) as unknown as ReturnType<typeof vi.fn>;
const get = (qs = "") => GET(new NextRequest(`http://localhost/api/artifacts${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([
    { id: "a1", title: "Page", type: "html", conversationId: "c1", updatedAt: "2026-01-01", conversation: { title: "My chat" } },
  ]);
});

describe("GET /api/artifacts", () => {
  it("scopes to the caller, selects no content, and flattens the chat title", async () => {
    const body = await (await get()).json();
    const args = findMany.mock.calls[0][0];
    expect(args.where.conversation).toEqual({ userId: "user-1", temporary: false });
    expect(args.select.content).toBeUndefined();
    expect(args.take).toBe(100);
    expect(body.artifacts[0]).toEqual({
      id: "a1", title: "Page", type: "html", conversationId: "c1", updatedAt: "2026-01-01", conversationTitle: "My chat",
    });
  });

  it("filters by title with q", async () => {
    await get("?q=%20dash%20");
    expect(findMany.mock.calls[0][0].where.title).toEqual({ contains: "dash" });
  });

  it("caps limit at 200 and falls back to 100 on junk", async () => {
    await get("?limit=9999");
    expect(findMany.mock.calls[0][0].take).toBe(200);
    await get("?limit=abc");
    expect(findMany.mock.calls[1][0].take).toBe(100);
  });
});
