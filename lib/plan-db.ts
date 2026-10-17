// Database side of the zero-based plan.
import { randomUUID } from "node:crypto";
import db, { type Tx } from "./db";
import { addMonths } from "./months";
import { CATEGORIES, type CategoryKey } from "@/types/expense";
import {
  fundBalancesBefore, fundKey, linesFromAverages, linesFromSubscriptions, summarise,
  type PlanLine, type PlanRow, type PlanSummary,
} from "./plan";

const LINE_COLUMNS = "ID, MONTH, KIND, CATEGORY, GROUP_ID, LABEL, CAST(PLANNED AS REAL) AS PLANNED, SORT_ORDER, SUBSCRIPTION_ID";
const ROW_SQL = `SELECT ID, KIND, CATEGORY, GROUP_ID, NAME, CAST(AMOUNT AS REAL) AS AMOUNT, SUBSCRIPTION_ID FROM LEDGER
  WHERE WORKSPACE_ID = ? AND MONTH = ? AND DELETED_AT IS NULL`;

export async function planLines(ws: string, month: string): Promise<PlanLine[]> {
  const [rows] = await db.execute(`SELECT ${LINE_COLUMNS} FROM PLAN_LINE WHERE WORKSPACE_ID = ? AND MONTH = ? AND DELETED_AT IS NULL ORDER BY SORT_ORDER, CREATED_AT`, [ws, month]);
  return rows as PlanLine[];
}

export async function planMonths(ws: string): Promise<string[]> {
  const [rows] = await db.execute("SELECT DISTINCT MONTH FROM PLAN_LINE WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL ORDER BY MONTH DESC", [ws]);
  return (rows as { MONTH: string }[]).map((r) => r.MONTH);
}

/** The month's plan with actuals, unplanned spend and fund balances carried in. */
export async function getPlan(ws: string, month: string): Promise<PlanSummary> {
  const lines = await planLines(ws, month);
  const [rowRows] = await db.execute(ROW_SQL, [ws, month]);
  const rows = rowRows as PlanRow[];
  // Fund history: every earlier month that has fund lines, with its rows.
  const [fundLineRows] = await db.execute(
    `SELECT ${LINE_COLUMNS} FROM PLAN_LINE WHERE WORKSPACE_ID = ? AND MONTH < ? AND KIND = 'fund' AND DELETED_AT IS NULL ORDER BY MONTH`, [ws, month],
  );
  const fundLines = fundLineRows as PlanLine[];
  const history: Array<{ month: string; lines: PlanLine[]; rows: PlanRow[] }> = [];
  for (const m of [...new Set(fundLines.map((l) => l.MONTH))]) {
    const [r] = await db.execute(ROW_SQL, [ws, m]);
    history.push({ month: m, lines: fundLines.filter((l) => l.MONTH === m), rows: r as PlanRow[] });
  }
  return summarise(lines, rows, fundBalancesBefore(history, month));
}

type NewLine = Omit<PlanLine, "ID" | "MONTH" | "SORT_ORDER">;

function insertLines(tx: Tx, ws: string, month: string, lines: NewLine[]): number {
  const existing = tx.all<PlanLine>(`SELECT ${LINE_COLUMNS} FROM PLAN_LINE WHERE WORKSPACE_ID = ? AND MONTH = ? AND DELETED_AT IS NULL`, [ws, month]);
  const seen = new Set(existing.map((l) => `${l.KIND}:${fundKey(l)}`));
  const seenSubs = new Set(existing.map((l) => l.SUBSCRIPTION_ID).filter(Boolean));
  let order = existing.reduce((m, l) => Math.max(m, l.SORT_ORDER), -1) + 1;
  let n = 0;
  for (const l of lines) {
    if (l.SUBSCRIPTION_ID && seenSubs.has(l.SUBSCRIPTION_ID)) continue;
    const k = `${l.KIND}:${fundKey(l)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    tx.run(
      "INSERT INTO PLAN_LINE (ID, WORKSPACE_ID, MONTH, KIND, CATEGORY, GROUP_ID, LABEL, PLANNED, SORT_ORDER, SUBSCRIPTION_ID) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [randomUUID(), ws, month, l.KIND, l.CATEGORY, l.GROUP_ID, l.LABEL, l.PLANNED, order++, l.SUBSCRIPTION_ID],
    );
    n++;
  }
  return n;
}

export function addLine(ws: string, month: string, line: NewLine): number {
  return db.transaction((tx) => insertLines(tx, ws, month, [line]));
}

/** Copies the latest earlier plan into `month` (lines already present are kept). */
export function copyPreviousPlan(ws: string, month: string): number {
  return db.transaction((tx) => {
    const prev = tx.all<{ MONTH: string }>("SELECT MAX(MONTH) AS MONTH FROM PLAN_LINE WHERE WORKSPACE_ID = ? AND MONTH < ? AND DELETED_AT IS NULL", [ws, month])[0]?.MONTH;
    if (!prev) return 0;
    const lines = tx.all<PlanLine>(`SELECT ${LINE_COLUMNS} FROM PLAN_LINE WHERE WORKSPACE_ID = ? AND MONTH = ? AND DELETED_AT IS NULL ORDER BY SORT_ORDER`, [ws, prev]);
    return insertLines(tx, ws, month, lines.map(({ KIND, CATEGORY, GROUP_ID, LABEL, PLANNED, SUBSCRIPTION_ID }) => ({ KIND, CATEGORY, GROUP_ID, LABEL, PLANNED, SUBSCRIPTION_ID })));
  });
}

/** One line per category+group from the average of the three months before `month`, rounded to 5 €. */
export function buildFromAverages(ws: string, month: string): number {
  return db.transaction((tx) => {
    const start = addMonths(month, -3);
    const avg = tx.all<{ KIND: "income" | "expense"; CATEGORY: string; GROUP_ID: string | null; GROUP_NAME: string | null; AVG: number }>(
      `SELECT e.KIND, e.CATEGORY, e.GROUP_ID, g.NAME AS GROUP_NAME, CAST(SUM(e.AMOUNT) AS REAL) / 3.0 AS AVG
       FROM LEDGER e LEFT JOIN CATEGORY_GROUP g ON g.ID = e.GROUP_ID AND g.DELETED_AT IS NULL
       WHERE e.WORKSPACE_ID = ? AND e.MONTH >= ? AND e.MONTH < ? AND e.DELETED_AT IS NULL AND e.SUBSCRIPTION_ID IS NULL
       GROUP BY e.KIND, e.CATEGORY, e.GROUP_ID ORDER BY e.KIND DESC, AVG DESC`,
      [ws, start, month],
    );
    const lines = linesFromAverages(avg.map((a) => ({
      KIND: a.KIND, CATEGORY: a.CATEGORY, GROUP_ID: a.GROUP_ID, AVG: a.AVG,
      LABEL: a.KIND === "income" ? "Income" : `${CATEGORIES[a.CATEGORY as CategoryKey]?.label ?? a.CATEGORY}${a.GROUP_NAME ? ` · ${a.GROUP_NAME}` : ""}`,
    })));
    return insertLines(tx, ws, month, lines);
  });
}

/** Adds every active subscription as a line (monthly ones as expense, others as funds). */
export function addSubscriptionLines(ws: string, month: string): number {
  return db.transaction((tx) => {
    const subs = tx.all<{ ID: string; NAME: string; CATEGORY: string; GROUP_ID: string | null; AMOUNT: number; CADENCE: "weekly" | "monthly" | "quarterly" | "yearly" }>(
      "SELECT ID, NAME, CATEGORY, GROUP_ID, CAST(AMOUNT AS REAL) AS AMOUNT, CADENCE FROM SUBSCRIPTION WHERE WORKSPACE_ID = ? AND STATUS = 'active' AND DELETED_AT IS NULL ORDER BY AMOUNT DESC",
      [ws],
    );
    return insertLines(tx, ws, month, linesFromSubscriptions(subs));
  });
}

/** Planned totals per group for the month view bars: GROUP_ID ("" = none) → planned/actual. */
export async function planByGroup(ws: string, month: string): Promise<Record<string, { planned: number; actual: number }>> {
  const summary = await getPlan(ws, month);
  if (summary.lines.length === 0) return {};
  const out: Record<string, { planned: number; actual: number }> = {};
  for (const l of summary.lines) {
    if (l.KIND === "income") continue;
    const k = l.GROUP_ID ?? "";
    out[k] ??= { planned: 0, actual: 0 };
    out[k].planned += l.PLANNED;
    out[k].actual += l.actual;
  }
  return out;
}
