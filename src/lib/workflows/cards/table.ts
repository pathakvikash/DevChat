import { renderTemplate, renderText } from "../template";
import { DEFAULT_STATUS, loadTable, normalizeKey, writeRows, type RowInput } from "../tables";
import type { CardImpl } from "./index";

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isScalar = (v: unknown) => typeof v === "string" || typeof v === "number" || typeof v === "boolean";

export const tableCard: CardImpl = {
  async run(c) {
    const { config, tctx, userId } = c;
    const table = await loadTable(userId, String(config.tableId ?? ""));
    if (!table) throw new Error("Table not found");
    const listed = renderTemplate(String(config.list ?? ""), tctx);
    if (!Array.isArray(listed.value)) throw new Error("Save to table needs a list to work on");

    const action = config.action === "update" ? "update" : "upsert";
    const keyField = String(config.keyField || "url");
    const columns = ((config.fields as { column: string; value: string }[] | undefined) ?? []).filter((f) => f.column.trim());
    const empty = new Set<string>();

    const inputs: RowInput[] = listed.value.map((raw, i) => {
      const item: Record<string, unknown> = isObject(raw) ? raw : { value: raw };
      const ic = { ...tctx, item: raw, index: i + 1 };
      let data: Record<string, unknown>;
      if (columns.length > 0) {
        data = {};
        for (const f of columns) {
          const r = renderTemplate(f.value, ic);
          for (const m of r.missing) empty.add(m);
          data[f.column.trim()] = r.value;
        }
      } else {
        data = Object.fromEntries(Object.entries(item).filter(([, v]) => isScalar(v)));
      }
      const rawKey = item[keyField] ?? data[keyField];
      const key = rawKey === undefined || rawKey === null ? "" : normalizeKey(rawKey);
      const status = renderText(String(config.status ?? ""), ic).text.trim();
      return { key: key || null, data, status: status || (action === "upsert" ? DEFAULT_STATUS : "") };
    });

    const r = await writeRows(table, action, inputs);
    const warnings = [...empty].slice(0, 10).map((m) => `{{${m}}} was empty`);
    const keyless = inputs.filter((x) => x.key === null).length;
    if (keyless > 0 && action === "upsert") warnings.push(`${keyless} ${keyless === 1 ? "item has" : "items have"} no ${keyField}, so ${keyless === 1 ? "it was" : "they were"} added without a key and can repeat`);
    if (r.missing.length > 0) warnings.push(`${r.missing.length} ${r.missing.length === 1 ? "item matched" : "items matched"} no row and ${r.missing.length === 1 ? "was" : "were"} left out`);
    return { output: { inserted: r.inserted, updated: r.updated, items: [...r.inserted, ...r.updated], missing: r.missing }, warnings };
  },
};
