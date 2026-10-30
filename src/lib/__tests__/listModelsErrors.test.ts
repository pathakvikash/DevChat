import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { listModels } from "@/lib/models";

const LEAK = "LEAKED-BODY-TEXT-10.0.0.5";

function stubFetch(reply: () => Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => (String(url).includes("/api/tags") ? new Response("{}") : reply())),
  );
}

async function customError(baseUrl: string) {
  const { status } = await listModels({ custom: { apiKey: "", baseUrl } });
  return status.find((s) => s.id === "custom")?.error;
}

afterEach(() => vi.unstubAllGlobals());

describe("provider errors shown to the client", () => {
  it("does not quote a body that is not JSON", async () => {
    stubFetch(async () => new Response(`<html>${LEAK}</html>`, { status: 200 }));
    expect(await customError("https://a.example/v1")).toBe("Invalid response");
  });

  it("shows the status code of a failed request, not its body", async () => {
    stubFetch(async () => new Response(LEAK, { status: 502 }));
    expect(await customError("https://b.example/v1")).toBe("HTTP 502");
  });

  it("hides network error details", async () => {
    stubFetch(async () => {
      throw new Error(`connect ECONNREFUSED ${LEAK}`);
    });
    expect(await customError("https://c.example/v1")).toBe("Could not reach this provider");
  });
});
