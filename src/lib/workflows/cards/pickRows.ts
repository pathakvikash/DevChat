import { prisma } from "@/lib/db";
import { pickStatuses, DEFAULT_MAX_PICK } from "../catalog";
import { loadTable } from "../tables";
import type { CardImpl } from "./index";

/**
 * Pick rows pauses the run. This only checks the table and says what to wait for; the runner saves the card and the run
 * as Waiting and stops. The run goes on when `continueRun` (runner.ts) gets the rows the user ticked.
 */
export const pickRowsCard: CardImpl = {
  async run(c) {
    const table = await loadTable(c.userId, String(c.config.tableId ?? ""));
    if (!table) throw new Error("Table not found");
    const statuses = pickStatuses(c.config);
    if (statuses.length === 0) throw new Error("Pick rows needs at least one status to offer");
    const offered = await prisma.dataTableRow.count({ where: { tableId: table.id, status: { in: statuses } } });
    // Nothing to tick: waiting would only stall the run.
    if (offered === 0) return { output: { items: [], count: 0 }, stop: `No rows to pick in “${table.name}”` };
    return {
      output: undefined,
      wait: {
        tableId: table.id,
        tableName: table.name,
        statuses,
        maxPick: Number(c.config.maxPick) || DEFAULT_MAX_PICK,
        message: String(c.config.message ?? ""),
        sortBy: String(c.config.sortBy ?? ""),
        setStatus: String(c.config.setStatus ?? ""),
        offered,
      },
    };
  },
};
