import { afterEach, describe, expect, it, vi } from "vitest";
import { appFetch } from "@/lib/net/safeFetch";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("appFetch", () => {
  it("never follows redirects", async () => {
    const f = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", f);
    vi.stubEnv("NODE_ENV", "development");
    await appFetch("http://localhost:3001/mcp");
    expect(f.mock.calls[0][1]).toMatchObject({ redirect: "error" });
  });

  it("in production refuses private and loopback hosts but allows a public address", async () => {
    const f = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", f);
    vi.stubEnv("NODE_ENV", "production");
    for (const u of ["http://localhost/x", "http://127.0.0.1/x", "http://169.254.169.254/x", "http://10.0.0.5/x"]) await expect(appFetch(u)).rejects.toThrow(/private/i);
    expect(f).not.toHaveBeenCalled();
    await appFetch("https://8.8.8.8/x");
    expect(f).toHaveBeenCalledTimes(1);
  });
});
