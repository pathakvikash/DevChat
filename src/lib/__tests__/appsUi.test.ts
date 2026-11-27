import { describe, expect, it } from "vitest";
import { appHomeHref, envSnippet, groupTools, permissionCopy } from "@/lib/apps/ui";

const tool = (name: string, readOnly: boolean) => ({ name, description: "", inputSchema: {}, readOnly });

describe("apps ui helpers", () => {
  it("builds the env snippet", () => {
    expect(envSnippet("s3cret")).toBe("ORRERY_APP_SECRET=s3cret\nORRERY_ISSUER=orrery");
  });
  it("splits tools by read-only", () => {
    const g = groupTools([tool("a", true), tool("b", false), tool("c", true)]);
    expect(g.readOnly.map((t) => t.name)).toEqual(["a", "c"]);
    expect(g.other.map((t) => t.name)).toEqual(["b"]);
  });
  it("explains each permission", () => {
    expect(permissionCopy("read").label).toBe("Read only");
    expect(permissionCopy("actions").detail).toMatch(/asks you/);
  });
  it("builds the launcher link", () => {
    expect(appHomeHref("printpro3d")).toBe("/api/apps/printpro3d/go?link=home");
  });
});
