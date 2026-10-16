// Read queries shared by several pages, so the "monthly totals" shape isn't
// copy-pasted with subtly different filters.
import db from "./db";
import type { Kind } from "@/types/expense";

export type MonthTotal = { MONTH: string; TOTAL: number };

/** Per-month sums of live rows of one kind, optionally bounded (inclusive). */
export async function monthlyTotals(kind: Kind, start?: string, end?: string): Promise<MonthTotal[]> {
  const where = ["KIND = ?", "DELETED_AT IS NULL"];
  const args: unknown[] = [kind];
  if (start) { where.push("MONTH >= ?"); args.push(start); }
  if (end) { where.push("MONTH <= ?"); args.push(end); }
  const [rows] = await db.execute(
    `SELECT MONTH, CAST(SUM(AMOUNT) AS REAL) AS TOTAL FROM LEDGER WHERE ${where.join(" AND ")} GROUP BY MONTH ORDER BY MONTH`,
    args,
  );
  return rows as MonthTotal[];
}

export type RecurringCandidate = { NAME: string; CATEGORY: string; MONTHS: number; AVG_AMOUNT: number; LAST_MONTH: string };

/**
 * Names that showed up in at least 3 of the last 4 months, about once a
 * month, and aren't flagged recurring yet. Weekly shopping (several rows a
 * month) is excluded on purpose.
 */
export async function recurringCandidates(sinceMonth: string): Promise<RecurringCandidate[]> {
  const [rows] = await db.execute(
    `SELECT NAME, CATEGORY, COUNT(DISTINCT MONTH) AS MONTHS, CAST(AVG(AMOUNT) AS REAL) AS AVG_AMOUNT, MAX(MONTH) AS LAST_MONTH
     FROM LEDGER
     WHERE KIND = 'expense' AND DELETED_AT IS NULL AND MONTH >= ?
       AND NAME NOT IN (SELECT NAME FROM LEDGER WHERE IS_RECURRING = 1 AND DELETED_AT IS NULL)
     GROUP BY NAME
     HAVING MONTHS >= 3 AND COUNT(*) <= MONTHS * 1.5
     ORDER BY AVG_AMOUNT DESC LIMIT 6`,
    [sinceMonth],
  );
  return rows as RecurringCandidate[];
}
