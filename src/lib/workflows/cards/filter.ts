import { applyRules, type FilterRule } from "../filterRules";
import { renderTemplate } from "../template";
import type { CardImpl } from "./index";

export const filterCard: CardImpl = {
  async run(c) {
    const listed = renderTemplate(String(c.config.list ?? ""), c.tctx);
    if (!Array.isArray(listed.value)) throw new Error("Filter needs a list to work on");
    const items = applyRules(listed.value, (c.config.rules as FilterRule[]) ?? [], c.config.match === "any" ? "any" : "all", c.tctx);
    const output = { items, count: items.length, removed: listed.value.length - items.length };
    const stop = items.length === 0 && c.config.stopIfEmpty !== false ? `Nothing left after ${c.node.ui.label || c.node.id}` : undefined;
    return { output, ...(stop ? { stop } : {}) };
  },
};
