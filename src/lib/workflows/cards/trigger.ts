import type { CardImpl } from "./index";

export const trigger: CardImpl = {
  async run(c) {
    return { output: { startedAt: c.tctx.run.startedAt, date: c.tctx.run.date } };
  },
};
