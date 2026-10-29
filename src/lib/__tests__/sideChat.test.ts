import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { listSideChats, createSideChat } from "@/lib/sideChat";

describe("sideChat client helpers", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("listSideChats GETs the side children of the parent and returns the list", async () => {
    const rows = [{ id: "s2", title: "Second", updatedAt: "2026-10-30T10:00:00.000Z" }];
    fetchMock.mockResolvedValue(new Response(JSON.stringify(rows), { status: 200 }));

    await expect(listSideChats("main1")).resolves.toEqual(rows);
    expect(fetchMock).toHaveBeenCalledWith("/api/conversations/main1/children?kind=side");
  });

  it("listSideChats throws when the request fails", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 404 }));

    await expect(listSideChats("main1")).rejects.toThrow("Failed to list side chats");
  });

  it("listSideChats encodes the parent id in the path", async () => {
    fetchMock.mockResolvedValue(new Response("[]", { status: 200 }));

    await listSideChats("a/b c");
    expect(fetchMock).toHaveBeenCalledWith("/api/conversations/a%2Fb%20c/children?kind=side");
  });

  it("createSideChat POSTs an empty JSON body when no model is given", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "s1" }), { status: 200 }));

    await expect(createSideChat("main1")).resolves.toEqual({ id: "s1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/conversations/main1/children");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({});
  });

  it("createSideChat sends the chosen model in the body", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "s1" }), { status: 200 }));

    await createSideChat("main1", "mock/fast");
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ model: "mock/fast" });
  });

  it("createSideChat throws when the request fails", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));

    await expect(createSideChat("main1")).rejects.toThrow("Failed to create side chat");
  });
});
