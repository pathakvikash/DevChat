import { describe, it, expect } from "vitest";
import nextConfig from "../../../next.config";
import { BRIDGE_ORIGIN } from "@/lib/bridge/constants";

describe("Content-Security-Policy", () => {
  it("lets the page reach the local bridge and nothing broader on loopback", async () => {
    const rules = await nextConfig.headers!();
    const csp = rules.find((r) => r.source === "/(.*)")!.headers.find((h) => h.key === "Content-Security-Policy")!.value;
    const connect = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("connect-src"))!;
    expect(BRIDGE_ORIGIN).toBe("http://127.0.0.1:47321");
    expect(connect).toBe("connect-src 'self' https: https://cdn.jsdelivr.net http://127.0.0.1:47321");
    expect(connect).not.toMatch(/localhost|http:\/\/\*|127\.0\.0\.1:\*|http:(?!\/\/127)/);
  });
});
