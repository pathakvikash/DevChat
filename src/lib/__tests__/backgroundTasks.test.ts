import { describe, expect, it } from "vitest";
import { elapsed, finishedHelpers, runningCount, tasksFrom } from "../chat/backgroundTasks";

const helper = (id: string, output?: object, state = "output-available") => ({
  type: "tool-runAgent",
  toolCallId: id,
  state,
  input: { task: "read the notes", title: "Note reader" },
  output,
});
const asst = (...parts: object[]) => ({ id: `m-${parts.length}`, role: "assistant", parts });

describe("tasksFrom", () => {
  it("is empty for an idle chat", () => {
    expect(tasksFrom([asst({ type: "text", text: "hi" })], false, [])).toEqual([]);
  });

  it("lists the running reply, a streaming helper, queued messages and agent talk in that order", () => {
    const msgs = [asst(helper("h1", { title: "Note reader", status: "running", startedAt: 1000, childId: "c1", step: 1, steps: [] }))];
    const tasks = tasksFrom(msgs, true, [{ id: "q1", text: "next" }], { withTitle: "Beta", hop: 1 }, 500);
    expect(tasks.map((t) => [t.kind, t.status])).toEqual([
      ["reply", "running"],
      ["helper", "running"],
      ["queued", "queued"],
      ["agent", "running"],
    ]);
    expect(tasks[0].startedAt).toBe(500);
    expect(tasks[1].childId).toBe("c1");
    expect(runningCount(tasks)).toBe(4);
  });

  it("a stored running helper that is no longer streaming was stopped", () => {
    const msgs = [asst(helper("h1", { title: "T", status: "running", startedAt: 1, step: 0, steps: [] }))];
    expect(tasksFrom(msgs, false, [])[0].status).toBe("stopped");
  });

  it("only the last assistant message streams", () => {
    const old = asst(helper("h1", { title: "A", status: "running", startedAt: 1, step: 0, steps: [] }));
    const last = { id: "m-last", role: "assistant", parts: [helper("h2", { title: "B", status: "running", startedAt: 2, step: 0, steps: [] })] };
    const tasks = tasksFrom([old, last], true, []);
    expect(tasks.filter((t) => t.kind === "helper").map((t) => t.status)).toEqual(["stopped", "running"]);
  });

  it("counts finished helpers, and maps done / error / timeout", () => {
    const done = { title: "A", status: "done", startedAt: 0, endedAt: 5000, step: 2, steps: [] };
    const tasks = tasksFrom([asst(helper("a", done), helper("b", { ...done, status: "timeout" }), helper("c", undefined, "output-error"))], false, []);
    expect(tasks.map((t) => t.status)).toEqual(["done", "timeout", "error"]);
    expect(finishedHelpers(tasks)).toHaveLength(3);
    expect(runningCount(tasks)).toBe(0);
  });

  it("falls back to the brief for the title", () => {
    expect(tasksFrom([asst(helper("a"))], true, [])[1].title).toBe("Note reader");
  });
});

describe("elapsed", () => {
  it("formats m:ss from start to end or now", () => {
    expect(elapsed({ id: "x", kind: "helper", title: "", startedAt: 0, endedAt: 65_000, status: "done" }, 999_999)).toBe("1:05");
    expect(elapsed({ id: "x", kind: "reply", title: "", startedAt: 1000, status: "running" }, 4000)).toBe("0:03");
    expect(elapsed({ id: "x", kind: "queued", title: "", startedAt: null, status: "queued" }, 4000)).toBe("");
  });
});
