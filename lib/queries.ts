// Read queries shared by several pages, so the "monthly totals" shape isn't
// copy-pasted with subtly different filters.
import db from "./db";
import type { Kind } from "@/types/expense";

export type MonthTotal = { MONTH: string; TOTAL: number };

/** Per-month sums of live rows of one kind, optionally bounded (inclusive). */
export async function monthlyTotals(ws: string, kind: Kind, start?: string, end?: string): Promise<MonthTotal[]> {
  const where = ["WORKSPACE_ID = ?", "KIND = ?", "DELETED_AT IS NULL"];
  const args: unknown[] = [ws, kind];
  if (start) { where.push("MONTH >= ?"); args.push(start); }
  if (end) { where.push("MONTH <= ?"); args.push(end); }
  const [rows] = await db.execute(
    `SELECT MONTH, CAST(SUM(AMOUNT) AS REAL) AS TOTAL FROM LEDGER WHERE ${where.join(" AND ")} GROUP BY MONTH ORDER BY MONTH`,
    args,
  );
  return rows as MonthTotal[];
}

/** Per-month totals of non-recurring expenses — the "variable" part of spending. */
export async function monthlyVariableTotals(ws: string, start: string, endExclusive: string): Promise<MonthTotal[]> {
  const [rows] = await db.execute(
    `SELECT MONTH, CAST(SUM(AMOUNT) AS REAL) AS TOTAL FROM LEDGER
     WHERE WORKSPACE_ID = ? AND KIND = 'expense' AND IS_RECURRING = 0 AND DELETED_AT IS NULL AND MONTH >= ? AND MONTH < ?
     GROUP BY MONTH ORDER BY MONTH`,
    [ws, start, endExclusive],
  );
  return rows as MonthTotal[];
}

export type RecurringCandidate = { NAME: string; CATEGORY: string; MONTHS: number; AVG_AMOUNT: number; LAST_MONTH: string };

/**
 * Names that showed up in at least 3 of the last 4 months, about once a
 * month, and aren't flagged recurring yet. Weekly shopping (several rows a
 * month) is excluded on purpose.
 */
export async function recurringCandidates(ws: string, sinceMonth: string): Promise<RecurringCandidate[]> {
  const [rows] = await db.execute(
    `SELECT NAME, CATEGORY, COUNT(DISTINCT MONTH) AS MONTHS, CAST(AVG(AMOUNT) AS REAL) AS AVG_AMOUNT, MAX(MONTH) AS LAST_MONTH
     FROM LEDGER
     WHERE WORKSPACE_ID = ? AND KIND = 'expense' AND DELETED_AT IS NULL AND MONTH >= ?
       AND NAME NOT IN (SELECT NAME FROM LEDGER WHERE WORKSPACE_ID = ? AND IS_RECURRING = 1 AND DELETED_AT IS NULL)
     GROUP BY NAME
     HAVING MONTHS >= 3 AND COUNT(*) <= MONTHS * 1.5
     ORDER BY AVG_AMOUNT DESC LIMIT 6`,
    [ws, sinceMonth, ws],
  );
  return rows as RecurringCandidate[];
}

// --- /analytics reports (computations live in lib/reports.ts) -------------

export type LedgerReportRow = {
  KIND: Kind; CATEGORY: string; GROUP_ID: string | null; NAME: string;
  AMOUNT: number; MONTH: string; DAY: number | null; GOAL_ID: string | null;
};

/** Every live row (both kinds) in an inclusive month range — one query feeds the Sankey, weekday split and savings chart. */
export async function ledgerRowsBetween(ws: string, start: string, end: string): Promise<LedgerReportRow[]> {
  const [rows] = await db.execute(
    `SELECT KIND, CATEGORY, GROUP_ID, NAME, CAST(AMOUNT AS REAL) AS AMOUNT, MONTH, DAY, GOAL_ID
     FROM LEDGER WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL AND MONTH >= ? AND MONTH <= ?`,
    [ws, start, end],
  );
  return rows as LedgerReportRow[];
}

export type GroupRefRow = { ID: string; NAME: string; COLOR: string };

export async function groupRefs(ws: string): Promise<GroupRefRow[]> {
  const [rows] = await db.execute(
    "SELECT ID, NAME, COLOR FROM CATEGORY_GROUP WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL ORDER BY SORT_ORDER, NAME",
    [ws],
  );
  return rows as GroupRefRow[];
}

export type MerchantMonthlyRow = { NAME: string; CATEGORY: string; MONTH: string; TOTAL: number; CNT: number };

/** Expense spend and visit count per (name, category, month) in an inclusive month range. */
export async function merchantMonthly(ws: string, start: string, end: string): Promise<MerchantMonthlyRow[]> {
  const [rows] = await db.execute(
    `SELECT NAME, CATEGORY, MONTH, CAST(SUM(AMOUNT) AS REAL) AS TOTAL, COUNT(*) AS CNT
     FROM LEDGER WHERE WORKSPACE_ID = ? AND KIND = 'expense' AND DELETED_AT IS NULL AND MONTH >= ? AND MONTH <= ?
     GROUP BY NAME, CATEGORY, MONTH`,
    [ws, start, end],
  );
  return rows as MerchantMonthlyRow[];
}
