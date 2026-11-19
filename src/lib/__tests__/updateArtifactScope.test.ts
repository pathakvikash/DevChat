import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { artifact: { findFirst: vi.fn(), update: vi.fn() } } }));

import { prisma } from "@/lib/db";
import { TOOL_REGISTRY } from "@/lib/registry";

const art = prisma.artifact as any;
const run = (ctx: { conversationId?: string }) => TOOL_REGISTRY.updateArtifact.execute!({ artifactId: "a1", content: "new" }, ctx);
beforeEach(() => vi.clearAllMocks());

describe("updateArtifact", () => {
  it("looks the artifact up in the calling chat only, so another chat's id is not found", async () => {
    art.findFirst.mockResolvedValue(null);
    expect(await run({ conversationId: "c1" })).toBe("Error: artifact a1 not found.");
    expect(art.findFirst).toHaveBeenCalledWith({ where: { id: "a1", conversationId: "c1" } });
    expect(art.update).not.toHaveBeenCalled();
  });

  it("finds nothing without a chat", async () => {
    expect(await run({})).toBe("Error: artifact a1 not found.");
    expect(art.update).not.toHaveBeenCalled();
  });

  it("updates an artifact of this chat", async () => {
    art.findFirst.mockResolvedValue({ id: "a1", content: "old", version: 1 });
    art.update.mockResolvedValue({ id: "a1", version: 2, title: "T" });
    expect(await run({ conversationId: "c1" })).toContain("Artifact updated: a1 (v2)");
  });
});
