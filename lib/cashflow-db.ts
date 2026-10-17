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
import { addDays, paydayOccurrences, project, type Event, type Payday, type Projection } from "./cashflow";

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
async function movementsSince(ws: string, date: string): Promise<number> {
  const month = date.slice(0, 7);
  const day = Number(date.slice(8, 10));
  const [rows] = await db.execute(
    `SELECT CAST(SUM(CASE WHEN KIND = 'income' THEN AMOUNT ELSE -AMOUNT END) AS REAL) AS NET FROM LEDGER
     WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL AND (MONTH > ? OR (MONTH = ? AND COALESCE(DAY, 1) > ?))`,
    [ws, month, month, day],
  );
  return (rows as { NET: number | null }[])[0]?.NET ?? 0;
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
  const paydayEvents = paydayOccurrences(paydays, today, addDays(today, HORIZON_DAYS));
  let balanceToday: number | null = null;
  if (checkpoint) balanceToday = Math.round((checkpoint.AMOUNT + (await movementsSince(ws, checkpoint.DATE))) * 100) / 100;
  const projection = balanceToday === null
    ? null
    : project({ today, startBalance: balanceToday, horizonDays: HORIZON_DAYS, paydays: paydayEvents, bills, dailyVariable, buffer });
  return { today, checkpoint, balanceToday, paydays, dailyVariable, buffer, projection, bills };
}
