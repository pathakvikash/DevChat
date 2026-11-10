import { asText, renderTemplate, renderText, type TemplateContext } from "./template";

export const FILTER_OPS = ["eq", "neq", "contains", "notContains", "gt", "gte", "lt", "lte", "empty", "notEmpty"] as const;
export type FilterOp = (typeof FILTER_OPS)[number];
export const FILTER_OP_LABELS: Record<FilterOp, string> = {
  eq: "equals",
  neq: "not equals",
  contains: "contains",
  notContains: "not contains",
  gt: "greater than",
  gte: "at least",
  lt: "less than",
  lte: "at most",
  empty: "is empty",
  notEmpty: "is not empty",
};
export interface FilterRule {
  field: string;
  op: FilterOp;
  value: string;
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/** A finite number, from a number or a numeric string; otherwise null. */
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Compares as numbers when both sides are finite numbers, otherwise as case-insensitive strings. Negative, zero, positive. */
function compare(a: unknown, b: string): number {
  const x = num(a);
  const y = num(b);
  if (x !== null && y !== null) return x - y;
  return asText(a).toLowerCase().localeCompare(b.toLowerCase());
}

/** One rule against the field's raw value and the rule's value as text. */
export function testRule(op: FilterOp, field: unknown, value: string): boolean {
  switch (op) {
    case "empty":
      return isEmpty(field);
    case "notEmpty":
      return !isEmpty(field);
    case "eq":
      return compare(field, value) === 0;
    case "neq":
      return compare(field, value) !== 0;
    case "contains":
      return asText(field).toLowerCase().includes(value.toLowerCase());
    case "notContains":
      return !asText(field).toLowerCase().includes(value.toLowerCase());
    case "gt":
      return compare(field, value) > 0;
    case "gte":
      return compare(field, value) >= 0;
    case "lt":
      return compare(field, value) < 0;
    case "lte":
      return compare(field, value) <= 0;
  }
}

/** The items that pass. The field side of each rule is rendered as a raw value and the value side as text, with `item` set. */
export function applyRules(list: unknown[], rules: FilterRule[], match: "all" | "any", ctx: TemplateContext): unknown[] {
  if (rules.length === 0) return list;
  return list.filter((item, i) => {
    const c = { ...ctx, item, index: i + 1 };
    const results = rules.map((r) => testRule(r.op, renderTemplate(r.field, c).value, renderText(r.value, c).text));
    return match === "any" ? results.some(Boolean) : results.every(Boolean);
  });
}
