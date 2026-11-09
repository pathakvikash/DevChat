import { ReconnectError, syncTableToSheet } from "@/lib/google/sheets";
import type { CardImpl } from "./index";

/** Overwrites the table's own Google sheet. The destination is the table's `sheetId`, never a card setting or a template. */
export const sheetSyncCard: CardImpl = {
  async run({ userId, config }) {
    try {
      return { output: await syncTableToSheet(userId, String(config.tableId ?? "")) };
    } catch (e) {
      if (e instanceof ReconnectError) throw new Error(`${e.message} Open Settings, choose ${e.connected ? "Reconnect" : "Connect"} Google, then resume this run.`);
      throw e;
    }
  },
};
