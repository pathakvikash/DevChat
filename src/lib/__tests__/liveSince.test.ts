import { describe, it, expect } from "vitest";
import { liveSince } from "@/lib/liveSince";

const cut = new Date("2024-06-01T12:00:00Z");

describe("liveSince", () => {
  it("keeps the cut message and later ones live, drops earlier ones", () => {
    const { isLive } = liveSince(cut);

    expect(isLive({ createdAt: new Date("2024-06-01T11:59:59Z") })).toBe(false);
    expect(isLive({ createdAt: cut })).toBe(true);
    expect(isLive({ createdAt: "2024-06-01T12:00:01Z" })).toBe(true);
  });

  it("keeps everything live before the first compression", () => {
    const { isLive, where } = liveSince(null);

    expect(isLive({ createdAt: new Date(0) })).toBe(true);
    expect(where).toEqual({});
  });

  it("gives matching Prisma filters, and one that matches nothing without a cut", () => {
    expect(liveSince(cut).where).toEqual({ createdAt: { gte: cut } });
    expect(liveSince(cut).summarizedWhere).toEqual({ createdAt: { lt: cut } });
    expect(liveSince(undefined).summarizedWhere).toEqual({ id: { in: [] } });
  });
});
