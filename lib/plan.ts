// Zero-based monthly plan: every euro of planned income is assigned to a
// line (expense or fund) so "left to plan" reaches zero. Pure logic here;
// database access in lib/plan-db.ts.
import type { Cadence } from "./subscriptions";
import { monthlyEquivalent } from "./subscriptions";

export const PLAN_KINDS = ["income", "expense", "fund"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export type PlanLine = {
  ID: string;
  MONTH: string;
  KIND: PlanKind;
  CATEGORY: string;
  GROUP_ID: string | null;
  LABEL: string;
  PLANNED: number;
  SORT_ORDER: number;
  SUBSCRIPTION_ID: string | null;
};

export type PlanRow = {
  ID: string;
  KIND: "income" | "expense";
  CATEGORY: string;
  GROUP_ID: string | null;
  NAME: string;
  AMOUNT: number;
  SUBSCRIPTION_ID: string | null;
};

export type LineProgress = PlanLine & {
  actual: number;
  remaining: number;
  rows: number;
  /** Running balance for fund lines (contributions − spending over time). */
  balance: number | null;
};

export type UnplannedGroup = { KIND: "income" | "expense"; CATEGORY: string; GROUP_ID: string | null; amount: number; rows: number };

export type PlanSummary = {
  lines: LineProgress[];
  unplanned: UnplannedGroup[];
  plannedIncome: number;
  plannedSpending: number;
  leftToPlan: number;
  actualIncome: number;
  actualSpending: number;
  unplannedSpending: number;
};

const key = (category: string, groupId: string | null) => `${category}\u0000${groupId ?? ""}`;

/**
 * Assigns each ledger row of the month to a plan line: by subscription
 * first, then category+group, then a category line without a group.
 * Returns the line id per row id (undefined = unplanned).
 */
export function matchRows(lines: PlanLine[], rows: PlanRow[]): Map<string, string> {
  const sorted = [...lines].sort((a, b) => a.SORT_ORDER - b.SORT_ORDER);
  const bySub = new Map<string, PlanLine>();
  const byKey = new Map<string, PlanLine>();
  const byCategory = new Map<string, PlanLine>();
  // Generic lines win the category match over subscription-specific ones, so
  // a stray "savings" row lands on "Savings", not on "Index fund transfer".
  const prefer = (map: Map<string, PlanLine>, k: string, l: PlanLine) => {
    const cur = map.get(k);
    if (!cur || (cur.SUBSCRIPTION_ID && !l.SUBSCRIPTION_ID)) map.set(k, l);
  };
  for (const l of sorted) {
    if (l.SUBSCRIPTION_ID && !bySub.has(l.SUBSCRIPTION_ID)) bySub.set(l.SUBSCRIPTION_ID, l);
    prefer(byKey, `${l.KIND === "income" ? "i" : "e"}:${key(l.CATEGORY, l.GROUP_ID)}`, l);
    if (l.GROUP_ID === null) prefer(byCategory, `${l.KIND === "income" ? "i" : "e"}:${l.CATEGORY}`, l);
  }
  const out = new Map<string, string>();
  for (const r of rows) {
    const side = r.KIND === "income" ? "i" : "e";
    const line =
      (r.SUBSCRIPTION_ID && bySub.get(r.SUBSCRIPTION_ID)) ||
      byKey.get(`${side}:${key(r.CATEGORY, r.GROUP_ID)}`) ||
      byCategory.get(`${side}:${r.CATEGORY}`);
    if (line) out.set(r.ID, line.ID);
  }
  return out;
}

export function summarise(lines: PlanLine[], rows: PlanRow[], fundBalances: Map<string, number> = new Map()): PlanSummary {
  const assignment = matchRows(lines, rows);
  const actual = new Map<string, { amount: number; rows: number }>();
  const unplannedMap = new Map<string, UnplannedGroup>();
  for (const r of rows) {
    const lineId = assignment.get(r.ID);
    if (lineId) {
      const a = actual.get(lineId) ?? { amount: 0, rows: 0 };
      a.amount += r.AMOUNT; a.rows++;
      actual.set(lineId, a);
    } else {
      const k = `${r.KIND}:${key(r.CATEGORY, r.GROUP_ID)}`;
      const u = unplannedMap.get(k) ?? { KIND: r.KIND, CATEGORY: r.CATEGORY, GROUP_ID: r.GROUP_ID, amount: 0, rows: 0 };
      u.amount += r.AMOUNT; u.rows++;
      unplannedMap.set(k, u);
    }
  }
  const progress: LineProgress[] = [...lines]
    .sort((a, b) => a.SORT_ORDER - b.SORT_ORDER)
    .map((l) => {
      const a = actual.get(l.ID) ?? { amount: 0, rows: 0 };
      const prior = fundBalances.get(fundKey(l)) ?? 0;
      return {
        ...l,
        actual: a.amount,
        rows: a.rows,
        remaining: l.KIND === "income" ? a.amount - l.PLANNED : l.PLANNED - a.amount,
        balance: l.KIND === "fund" ? prior + l.PLANNED - a.amount : null,
      };
    });
  const plannedIncome = progress.filter((l) => l.KIND === "income").reduce((s, l) => s + l.PLANNED, 0);
  const plannedSpending = progress.filter((l) => l.KIND !== "income").reduce((s, l) => s + l.PLANNED, 0);
  const unplanned = [...unplannedMap.values()].sort((a, b) => b.amount - a.amount);
  return {
    lines: progress,
    unplanned,
    plannedIncome,
    plannedSpending,
    leftToPlan: plannedIncome - plannedSpending,
    actualIncome: rows.filter((r) => r.KIND === "income").reduce((s, r) => s + r.AMOUNT, 0),
    actualSpending: rows.filter((r) => r.KIND === "expense").reduce((s, r) => s + r.AMOUNT, 0),
    unplannedSpending: unplanned.filter((u) => u.KIND === "expense").reduce((s, u) => s + u.amount, 0),
  };
}

/** Identity of a fund across months: kind + category + group + label. */
export function fundKey(l: Pick<PlanLine, "CATEGORY" | "GROUP_ID" | "LABEL">): string {
  return `${l.CATEGORY}\u0000${l.GROUP_ID ?? ""}\u0000${l.LABEL.trim().toLowerCase()}`;
}

/**
 * Balance carried into `month` for every fund: Σ(planned − actual) over the
 * earlier months, given each earlier month's lines and rows.
 */
export function fundBalancesBefore(history: Array<{ month: string; lines: PlanLine[]; rows: PlanRow[] }>, month: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const h of history.filter((h) => h.month < month).sort((a, b) => a.month.localeCompare(b.month))) {
    const summary = summarise(h.lines, h.rows, out);
    for (const l of summary.lines) if (l.KIND === "fund" && l.balance !== null) out.set(fundKey(l), l.balance);
  }
  return out;
}

export function roundTo(n: number, step = 5): number {
  return Math.max(step, Math.round(n / step) * step);
}

/** Lines suggested from average spend per category+group. */
export function linesFromAverages(
  averages: Array<{ KIND: "income" | "expense"; CATEGORY: string; GROUP_ID: string | null; AVG: number; LABEL: string }>,
): Array<Omit<PlanLine, "ID" | "MONTH" | "SORT_ORDER">> {
  return averages
    .filter((a) => a.AVG > 0)
    .map((a) => ({ KIND: a.KIND, CATEGORY: a.CATEGORY, GROUP_ID: a.GROUP_ID, LABEL: a.LABEL, PLANNED: roundTo(a.AVG), SUBSCRIPTION_ID: null }));
}

/** A line per active subscription: monthly ones as expense, others as funds saving the monthly share. */
export function linesFromSubscriptions(
  subs: Array<{ ID: string; NAME: string; CATEGORY: string; GROUP_ID: string | null; AMOUNT: number; CADENCE: Cadence }>,
): Array<Omit<PlanLine, "ID" | "MONTH" | "SORT_ORDER">> {
  return subs.map((s) => ({
    KIND: s.CADENCE === "monthly" ? "expense" : "fund",
    CATEGORY: s.CATEGORY,
    GROUP_ID: s.GROUP_ID,
    LABEL: s.NAME,
    PLANNED: Math.round(monthlyEquivalent(s.AMOUNT, s.CADENCE) * 100) / 100,
    SUBSCRIPTION_ID: s.ID,
  }));
}
