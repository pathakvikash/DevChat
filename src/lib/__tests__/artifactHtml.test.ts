import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireUserId: async () => "u1" }));
vi.mock("@/lib/api/artifacts", () => ({
  findConversationArtifact: async () => ({ ok: true, artifact: { type: "html", content: "<!DOCTYPE html><html><head><script>fetch('https://x')</script></head></html>" } }),
}));

import { withNoNetworkCsp } from "@/lib/api/artifactHtml";
import { GET } from "@/app/api/conversations/[id]/artifacts/[artifactId]/html/route";

const CSP = `<meta http-equiv="Content-Security-Policy" content="connect-src 'none'; form-action 'none'">`;

describe("HTML artifact preview CSP", () => {
  it("puts the CSP meta before any other element", () => {
    expect(withNoNetworkCsp("<script>1</script>")).toBe(`${CSP}<script>1</script>`);
  });

  it("keeps a doctype first, so the page stays out of quirks mode", () => {
    expect(withNoNetworkCsp("  <!DOCTYPE html><html></html>")).toBe(`  <!DOCTYPE html>${CSP}<html></html>`);
  });

  it("the preview route serves the page with the meta before its scripts", async () => {
    const res = await GET({} as never, { params: Promise.resolve({ id: "c", artifactId: "a" }) });
    const body = await res.text();
    expect(body.indexOf(CSP)).toBeGreaterThan(-1);
    expect(body.indexOf(CSP)).toBeLessThan(body.indexOf("<script>"));
  });
});
