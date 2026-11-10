import { describe, it, expect } from "vitest";
import { dropCompressedMessages } from "@/lib/chat/dropCompressedMessages";

const summarized = ["old-q", "old-a"];
const ids = (ms: { id?: string }[]) => ms.map((m) => m.id);

describe("dropCompressedMessages", () => {
  it("drops everything up to the last summarized message and keeps the rest", () => {
    const incoming = [{ id: "old-q" }, { id: "old-a" }, { id: "kept-q" }, { id: "kept-a" }, { id: "new-q" }];

    expect(ids(dropCompressedMessages(incoming, summarized))).toEqual(["kept-q", "kept-a", "new-q"]);
  });

  it("drops summarized messages the database has no row for, by position", () => {
    const incoming = [{ id: "compression-1" }, { id: "unsaved" }, { id: "old-q" }, { id: "unsaved-2" }, { id: "old-a" }, { id: "kept-q" }, { id: "new-q" }];

    expect(ids(dropCompressedMessages(incoming, summarized))).toEqual(["kept-q", "new-q"]);
  });

  it("keeps unknown messages that come after the last summarized one", () => {
    const incoming = [{ id: "old-a" }, { id: "unsaved" }, { id: "new-q" }];

    expect(ids(dropCompressedMessages(incoming, summarized))).toEqual(["unsaved", "new-q"]);
  });

  it("never drops the last message, the one being answered", () => {
    const incoming = [{ id: "old-a" }, { id: "old-q" }];

    expect(ids(dropCompressedMessages(incoming, summarized))).toEqual(["old-q"]);
  });
});
