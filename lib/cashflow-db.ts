// Database side of cash flow: paydays, balance checkpoints and the projection
// assembled from subscriptions and the variable-spend rate.
import db from "./db";
import { addMonths, currentMonth, daysInMonth } from "./months";
import { variableDailyRate } from "./forecast";
import { monthlyVariableTotals } from "./queries";
import { listSubscriptions } from "./subscriptions-db";
import { upcoming } from "./subscriptions";
import { DEFAULT_PREFERENCES } from "./preferences";
import { getPreferences } from "./preferences-db";
import { addDays, dropLoggedPaydays, paydayOccurrences, project, type Event, type Payday, type Projection } from "./cashflow";

export const HORIZON_DAYS = 60;
export const DEFAULT_BUFFER = DEFAULT_PREFERENCES.safeBuffer;

export type Checkpoint = { ID: string; DATE: string; AMOUNT: number; NOTE: string | null };

export async function listPaydays(ws: string): Promise<Payday[]> {
  const [rows] = await db.execute(
    "SELECT ID, LABEL, CAST(AMOUNT AS REAL) AS AMOUNT, CADENCE, DAY, START_DATE FROM PAYDAY WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL ORDER BY AMOUNT DESC, LABEL", [ws],
  );
  return rows as Payday[];
}

export async function latestCheckpoint(ws: string): Promise<Checkpoint | null> {
  const [rows] = await db.execute(
    "SELECT ID, DATE, CAST(AMOUNT AS REAL) AS AMOUNT, NOTE FROM BALANCE_CHECKPOINT WHERE WORKSPACE_ID = ? ORDER BY DATE DESC, CREATED_AT DESC LIMIT 1", [ws],
  );
  return (rows as Checkpoint[])[0] ?? null;
}

/** Ledger movements (income − expenses) on or after a date, so an older checkpoint still gives today's balance. */
const ROW_DATE = "(MONTH || '-' || printf('%02d', COALESCE(DAY, 1)))";

/** Ledger movements after the checkpoint and up to today (rows dated later are not money that moved yet). */
async function movementsSince(ws: string, date: string, today: string): Promise<number> {
  const [rows] = await db.execute(
    `SELECT CAST(SUM(CASE WHEN KIND = 'income' THEN AMOUNT ELSE -AMOUNT END) AS REAL) AS NET FROM LEDGER
     WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL AND ${ROW_DATE} > ? AND ${ROW_DATE} <= ?`,
    [ws, date, today],
  );
  return (rows as { NET: number | null }[])[0]?.NET ?? 0;
}

/** Rows already entered with a date after today (copied recurring bills, a logged salary): they are future events. */
async function futureRows(ws: string, today: string, until: string): Promise<Array<{ date: string; name: string; amount: number; kind: "income" | "expense" }>> {
  const [rows] = await db.execute(
    `SELECT ${ROW_DATE} AS D, NAME, CAST(AMOUNT AS REAL) AS AMOUNT, KIND FROM LEDGER
     WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL AND DAY IS NOT NULL AND ${ROW_DATE} > ? AND ${ROW_DATE} <= ?`,
    [ws, today, until],
  );
  return (rows as { D: string; NAME: string; AMOUNT: number; KIND: "income" | "expense" }[]).map((r) => ({ date: r.D, name: r.NAME, amount: r.AMOUNT, kind: r.KIND }));
}

export type CashflowView = {
  today: string;
  checkpoint: Checkpoint | null;
  /** Checkpoint rolled forward with ledger rows entered since. */
  balanceToday: number | null;
  paydays: Payday[];
  dailyVariable: number;
  buffer: number;
  projection: Projection | null;
  bills: Event[];
};

/**
 * `buffer` is the amount kept aside before money counts as safe to spend:
 * a number, or `{ userId }` to use that user's Settings → Preferences value.
 */
export async function getCashflow(ws: string, today: string, bufferOrUser: number | { userId: string } = DEFAULT_BUFFER): Promise<CashflowView> {
  const buffer = typeof bufferOrUser === "number" ? bufferOrUser : (await getPreferences(bufferOrUser.userId)).safeBuffer;
  const [paydays, checkpoint, subs] = await Promise.all([listPaydays(ws), latestCheckpoint(ws), listSubscriptions(ws, today)]);
  const thisMonth = currentMonth();
  const history = await monthlyVariableTotals(ws, addMonths(thisMonth, -6), thisMonth);
  const dailyVariable = variableDailyRate(history.map((m) => ({ total: m.TOTAL, days: daysInMonth(m.MONTH) }))) ?? 0;
  const bills: Event[] = upcoming(
    subs.map((s) => ({ name: s.NAME, amount: s.AMOUNT, status: s.STATUS, cadence: s.CADENCE, day: s.DAY, monthOfYear: s.MONTH_OF_YEAR, lastCharge: s.lastCharge })),
    today, HORIZON_DAYS,
  ).map((u) => ({ date: u.date, label: u.sub.name, amount: u.amount, kind: "bill" as const }));
  const until = addDays(today, HORIZON_DAYS);
  const future = await futureRows(ws, today, until);
  // Logged future expenses are bills on their date; logged future income is a payday.
  for (const f of future) {
    if (f.kind === "expense") bills.push({ date: f.date, label: f.name, amount: f.amount, kind: "bill" });
  }
  const [incomeRows] = await db.execute(
    `SELECT MONTH, CAST(AMOUNT AS REAL) AS AMOUNT FROM LEDGER WHERE WORKSPACE_ID = ? AND KIND = 'income' AND DELETED_AT IS NULL AND MONTH >= ? AND MONTH <= ?`,
    [ws, today.slice(0, 7), until.slice(0, 7)],
  );
  const paydayEvents = [
    ...dropLoggedPaydays(paydayOccurrences(paydays, today, until), (incomeRows as { MONTH: string; AMOUNT: number }[]).map((r) => ({ month: r.MONTH, amount: r.AMOUNT }))),
    ...future.filter((f) => f.kind === "income").map((f) => ({ date: f.date, label: f.name, amount: f.amount, kind: "payday" as const })),
  ];
  let balanceToday: number | null = null;
  if (checkpoint) balanceToday = Math.round((checkpoint.AMOUNT + (await movementsSince(ws, checkpoint.DATE, today))) * 100) / 100;
  const projection = balanceToday === null
    ? null
    : project({ today, startBalance: balanceToday, horizonDays: HORIZON_DAYS, paydays: paydayEvents, bills, dailyVariable, buffer });
  return { today, checkpoint, balanceToday, paydays, dailyVariable, buffer, projection, bills };
}
